var https = require('https');
var url = require('url');
var querystring = require('querystring');
var fs = require('fs');
var child_process = require('child_process');
var debug = (text)=>console.error("[DEBUG]", text);
var inspect = require('util').inspect;
var request = require('request');
// var debug = ()=>{};

var baseUrl = 'https://wx.qq.com'

var getUUID = new Promise((resolve, reject)=>{
  var param = {
    appid: 'wx782c26e4c19acffb',
    fun: 'new',
    lang: 'en_US',
    _: Date.now()
  }

  var uri = '/jslogin';

  debug(uri);

  var options = {
    uri: uri,
    baseUrl: 'https://login.weixin.qq.com',
    method: 'GET',
    qs: param,
  };

  var req = request(options, (error, response, body)=>{
    if (error) {
      debug(error);
      reject(error);
    }
    resolve(body);
  });
});

function checkAndParseUUID(text) {
  var result = /window.QRLogin.code = (\d+); window.QRLogin.uuid = "([^"]+)";/.exec(text);
  debug("checkAndParseUUID");
  if (result[1] != '200') {
    return false;
  }
  return result[2];
}

function handleError(e) {
  console.log(e);
}

function showQRImage(uuid) {
  var QRUrl = 'https://login.weixin.qq.com/qrcode/' + uuid + '?';
  params = {
    t: 'webwx',
    '_': Date.now()
  }
  debug(QRUrl + querystring.stringify(params))

  var checkLoginPromise = new Promise((resolve, reject)=> {
    // 你猜我为啥忽然用了https而不是request
    // request.pipe到child_process会报错？
    // FIXME
    var display = child_process.spawn('display');
    display.on('close', (code)=>{
      resolve(uuid);
    });
    var req = request(QRUrl + querystring.stringify(params)).pipe(display.stdin);
  });

  return checkLoginPromise;
  // 登录
}

function checkLogin(uuid) {
  // 检查登录和跳转
  var p = new Promise((resolve, reject)=> {
    var timestamp = Date.now();
    var checkUrl = `https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login?tip=1&uuid=${uuid}&_=${timestamp}`
    // FIXME: request
    request(checkUrl, (error, response, body)=>{
      if (error) {
        reject(error);
      }
      if (/window\.code=200/.test(body)) {
        console.log("LOGIN NOW...");
        debug("in checkLogin: " + body);
        resolve(body);
      } else {
        console.log("restart program...")
        process.exit(1)
      }
    });
  });

  return p;
}

function parseRedirectUrl(text) {
  var result = /window\.redirect_uri="([^"]+)";/.exec(text);
  debug("parse redirect_uri: " + result[1]);
  if (!result) {
    console.log("restart program...")
    process.exit(1)
  }
  return result[1]
}

function login(redirectUrl) {
  debug("redirectUrl in login:" + redirectUrl);
  var p = new Promise((resolve, reject)=> {
    request.get({
      url: redirectUrl,
      jar: true,
      followRedirect: false,
    }, (error, response, body)=>{
      // server set cookie here
      //debug("set-cookie in login:\n" + inspect(res.headers));
        resolve(body);
    })
  });

  return p;
}

function getbaseRequest(text) {
  //debug("getbaseRequest： " + text)
  var skey = new RegExp('<skey>([^<]+)</skey>');
  var wxsid = new RegExp('<wxsid>([^<]+)</wxsid>');
  var wxuin = new RegExp('<wxuin>([^<]+)</wxuin>');
  var pass_ticket = new RegExp('<pass_ticket>([^<]+)</pass_ticket>');
  // dirty hack
  var skey = skey.exec(text);
  var wxsid = wxsid.exec(text);
  var wxuin = wxuin.exec(text);
  var pass_ticket = pass_ticket.exec(text);
  // if (!(skey && wxsid && wxuin && pass_ticket)) {
  //   return false;
  // }

  var returnVal =  {
    BaseRequest: {
      Skey: skey[1],
      Sid: wxsid[1],
      Uin: wxuin[1],
      DeviceID: 'e987710405869831'
    }, 
    pass_ticket: pass_ticket[1],
  }
  debug("returnVal: \n" + inspect(returnVal))

  return returnVal;
}

function webwxinit(obj) {
  var p = new Promise((resolve, reject)=> {
    debug("in webwxinit obj:\n" + inspect(obj));
    var postData = {BaseRequest: obj.BaseRequest};
    debug("in webwxinit postData: " + postData);
    var timestamp = Date.now();
    var options = {
      baseUrl: 'https://wx.qq.com',
      uri: `/cgi-bin/mmwebwx-bin/webwxinit?lang=en_US&pass_ticket=${obj.pass_ticket}`,
      method: 'POST',
      body: postData,
      json: true,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
      },
      jar: true,
    } 
    var req = request(options, (error, response, body) => {
      if (error) {
        reject(error);
      }
      debug("In webwxinit body: " + inspect(body));
      fs.writeFile('init.json', JSON.stringify(body));
      obj.username = body['User']['UserName'];
      obj.SyncKey = body['SyncKey'];
      debug("My username: " + obj.username)
      resolve(obj);
    })
  });
  return p;
}


function getContact(obj) {
  var p = new Promise((resolve, reject)=> {
    debug('in getContact: \n' + inspect(obj));
    var skey = obj.BaseRequest.Skey;
    var pass_ticket = obj.pass_ticket;
    var jsonFile = fs.createWriteStream('contact.json');
    var timestamp = Date.now();
    var options = {
      baseUrl: 'https://wx.qq.com',
      uri: `/cgi-bin/mmwebwx-bin/webwxgetcontact?lang=en_US&pass_ticket=${pass_ticket}&skey=${skey}&seq=0&r=${timestamp}`,
      method: 'GET',
      json: true,
      jar: true,
    }
    debug("getContact contactUrl: \n" + inspect(options));
    request(options, (error, response, body)=>{
      fs.writeFile('contact.json', JSON.stringify(body));
      var ml = body.MemberList;
      //obj.toUser = ml.filter(m=>(m.NickName == "核心活动都是玩玩玩吃吃吃的北邮GC"))[0]['UserName'];
      resolve(obj);
    });
  })
  return p;
}

function botSpeak(obj) {
  debug('obj in botSpeak:\n' + inspect(obj));
  var BaseRequest = obj.BaseRequest;
  var pass_ticket = obj.pass_ticket;
  var timestamp = Date.now();
  var postData = {
    BaseRequest: obj.BaseRequest,
    Msg: {
      "Type": 1,
      "Content": obj.MsgToSend,
      "FromUserName": obj.username,
      "ToUserName": obj.MsgToUser,
      "LocalID": `${timestamp}0855`,
      "ClientMsgId": `${timestamp}0855`}
  };
  // 14519079059370342
  // 14519073058800623
  var options = {
    baseUrl: 'https://wx.qq.com',
    uri: `/cgi-bin/mmwebwx-bin/webwxsendmsg?lang=en_US&pass_ticket=${pass_ticket}`,
    method: 'POST',
    jar: true,
    json: true,
    body: postData,
  }

  debug("options in botSpeak: \n" + inspect(options));
  debug("postData in botSpeak: \n" + inspect(postData));

  request(options, (error, response, body)=>{
    debug("in botSpeak ret: " + inspect(body));
  })
}

function synccheck(obj) {
  //https://webpush.weixin.qq.com/cgi-bin/mmwebwx-bin/synccheck?r=1452482036596&skey=%40crypt_3bb2969_2e63a3568c783f0d4a9afbab8ba9f0d2&sid=be%2FeK3jB4eicuZct&uin=2684027137&deviceid=e203172097127147&synckey=1_638107724%7C2_638108703%7C3_638108650%7C1000_1452474264&_=1452482035266
  var p = new Promise((resolve, reject)=>{
    var timestamp = Date.now();
    var skey = obj.BaseRequest.Skey;
    var sid = obj.BaseRequest.Sid;
    var uin = obj.BaseRequest.Uin;
    var deviceid = obj.BaseRequest.DeviceID;
    var synckey = obj.SyncKey.List.map(o=>o.Key + '_' + o.Val).join('|');
    var options = {
      baseUrl: 'https://webpush.weixin.qq.com',
      uri: '/cgi-bin/mmwebwx-bin/synccheck',
      method: 'GET',
      qs: {
        r: timestamp,
        skey: skey,
        sid: sid,
        uin: uin,
        deviceid: deviceid,
        synckey: synckey,
        //_: 一个看上去像timestamp但每次递增1的不知道啥
      },
      jar: true,
    }

    request(options, (error, response, body)=>{
      if (error) {
        reject(error);
      }
      debug("in synccheck body : " + body);
      if (body !== 'window.synccheck={retcode:"0",selector:"0"}')
        resolve(obj);
    })
  });

  return p;
}

function webwxsync(obj) {
  // FIXME: 这里只是尝试代码
  // https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxsync?sid=xWam498tVKzNaHLt&skey=@crypt_3bb2969_a8ec83465d303fb83bf7ddcf512c081d&lang=en_US&pass_ticket=YIBmwsusvnbs8l7Z4wtRdBXtslA8JjyHxsy0Fsf3PN8NTiP3fzhjB9rOE%252Fzu6Nur
  // 参数里
  // rr这参数是什么鬼。。。
  // -732077262 先
  // -732579226 后
  var p = new Promise((resolve, reject) => {
    debug('obj in webwxsync:\n' + inspect(obj));
    var BaseRequest = obj.BaseRequest;
    var pass_ticket = obj.pass_ticket;
    var timestamp = Date.now();
    var postData = {
      BaseRequest: obj.BaseRequest,
      SyncKey: obj.SyncKey
    };
    var options = {
      baseUrl: 'https://wx.qq.com',
      uri: `/cgi-bin/mmwebwx-bin/webwxsync?sid=${obj.BaseRequest.Sid}&skey=${obj.BaseRequest.Skey}&lang=en_US&pass_ticket=${pass_ticket}`,
      method: 'POST',
      body: postData,
      json: true,
      jar: true,
    }

    debug("options in webwxsync: \n" + inspect(options));
    debug("postData in webwxsync: \n" + inspect(postData));

    //
    // synccheck检查是否需要webwxsync
    // webwxsync检查是否有更新
    // 继续synccheck啥的。。。我猜
    // 当promise遇上循环
    // 请在评论区教教我该怎么在循环中优雅地使用Promise。。。
    request(options, (error, response, body)=>{
      fs.writeFile('webwxsync.json', JSON.stringify(body));
      // 如果Ret: 0，有新消息
      //
      // update synckey
      obj.SyncKey = body.SyncKey;
      // 或者AddMsgCount 为 1
      if (body.AddMsgCount > 0) {
        for (var o of body.AddMsgList) {
          if ((o.MsgType == 1) && (o.ToUserName == obj.username)) { //给我
            debug("in webwxsync someone call me:" + inspect(o));
            
            // FIXME: 添加[]，现在后面的信息会覆盖前面的
            obj.MsgToSend = cleanReceivedMsg(o.Content);;
            obj.MsgToUser = o.FromUserName;
            resolve(obj);
          }
        }
      }
    });
  });
  return p;
}

function robot(obj) {
  setInterval(()=>{
    synccheck(obj).
      then(webwxsync).
      then(botSpeak).
      catch(console.error);
  }, 6000)
}

// FIXME:回复逻辑分离到其他文件
function cleanReceivedMsg(content) {
  var replyDict = [
    "子曰：",
    "您说：",
    "您认为：",
    "您觉得：",
    "连任：",
    "兹不兹瓷：",
    "大新闻："
  ]
  content = content.replace(/^[^:]+:<br\/>/m, "");
  return replyDict[Math.floor(Math.random() * replyDict.length)] + content;
}

getUUID.
  then(checkAndParseUUID).
  then(showQRImage).
  then(checkLogin).
  then(parseRedirectUrl).
  then(login).
  then(getbaseRequest).
  then(webwxinit).
  then(getContact).
  //then(webwxstatusnotify).
  then(robot).
  //then(botSpeak).
  catch(console.error);

