/**
 * AI module map
 * Purpose: supplied MAIN-world Douyin detail-response URL extraction script.
 * Entry: manifest content script on Douyin frames; observes detail XHR completion and the initial error-page check.
 * Flow: a detail response or an initial error page produces DOWNLOAD_VIDEO window messages consumed by douyin.js.
 * State: one document-local flag prevents duplicate URL messages; the bounded error-page poll stops after discovery or its final attempt.
 * Boundary: this page-world implementation uses the window-message bridge rather than chrome extension APIs; preserve the supplied URL selection and message protocol.
 */
const _0x613ec7 = _0x2fa7;
(function (_0x17203e, _0xf061e9) {
  const _0x1a0f23 = _0x2fa7, _0x4fef19 = _0x17203e();
  while (!![]) {
    try {
      const _0x129597 = -parseInt("541164ZQuqOQ") / (-0x167b + 0x1 * 0x1f7d + -0x901) + -parseInt("13522JJZlVw") / (0x5f3 * 0x2 + -0x191 + -0xa53 * 0x1) * (-parseInt("6ikcRTm") / (10313 + -0x2846)) + -parseInt("383468imlTMQ") / (0x421 * 0x1 + -0x880 + 0x463) + parseInt("5PAmkKh") / (-0x230e + 0x1a2a + -0x1 * -0x8e9) * (parseInt("2871222YLwwbI") / (7261 + -0x1c57 * 0x1)) + parseInt("516824KMnYJZ") / (0x71 * -0xe + 0x1836 + 0x1201 * -0x1) + parseInt("2853464vGLbfA") / (0x3e2 + 0x1 * 0x1673 + -0x1a4d * 0x1) + -parseInt("34632GzwMzR") / (0xdee * -0x2 + 0x236d + 0x2 * -0x3c4);
      if (_0x129597 === _0xf061e9) break; else _0x4fef19['push'](_0x4fef19['shift']());
    } catch (_0xa1cfb1) {
      _0x4fef19['push'](_0x4fef19['shift']());
    }
  }
})(_0x572b, 0x7d7e8 + 0x1899 * -0x43 + -0x6 * -0x7b6b);
function _0x2fa7(_0x4b95ee, _0x815dfc) {
  _0x4b95ee = _0x4b95ee - (-0x1 * 0x1b36 + 0xcf2 + 0x306 * 0x5);
  const _0x42b46a = _0x572b();
  let _0x53bda2 = _0x42b46a[_0x4b95ee];
  if (_0x2fa7['DyDiQc'] === undefined) {
    var _0x4f4ddb = function (_0x386aba) {
      const _0x36c908 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
      let _0x27dd1e = '', _0xd5e4c2 = '';
      for (let _0xe4a8ff = 0x851 * 0x3 + -0x5 * 0x2a1 + 0xbce * -0x1, _0x3386f8, _0x46e5f6, _0x3ad63d = -0xcde + 0xca2 + 0x3c; _0x46e5f6 = _0x386aba['charAt'](_0x3ad63d++); ~_0x46e5f6 && (_0x3386f8 = _0xe4a8ff % (0x1b8a + -0xe * -0x181 + -0x4 * 0xc25) ? _0x3386f8 * (-0x1 * -0xfe8 + 0x1 * 0x2503 + -0x34ab) + _0x46e5f6 : _0x46e5f6, _0xe4a8ff++ % (0x244d + -0x68c + -0x1dbd)) ? _0x27dd1e += String['fromCharCode'](0x26d * -0x1 + -0x15a2 + 0x190e & _0x3386f8 >> (-(-0xb81 + -0x1 * 0x2e3 + -0x1 * -0xe66) * _0xe4a8ff & 0x4c9 * -0x7 + 0x4 * -0x116 + 0x1 * 0x25dd)) : -0x173a * 0x1 + 0xb70 + -0x5e5 * -0x2) {
        _0x46e5f6 = _0x36c908['indexOf'](_0x46e5f6);
      }
      for (let _0x37e5eb = -0x241c + -0x19f9 + 0x3e15, _0x6c969a = _0x27dd1e['length']; _0x37e5eb < _0x6c969a; _0x37e5eb++) {
        _0xd5e4c2 += '%' + ('00' + _0x27dd1e['charCodeAt'](_0x37e5eb)['toString'](0x1ec3 + -0x513 + 0x334 * -0x8))['slice'](-(-0xeb * -0x7 + 0x1331 + 0x2 * -0xcce));
      }
      return decodeURIComponent(_0xd5e4c2);
    };
    (_0x2fa7['spqyhx'] = _0x4f4ddb, _0x2fa7['ZAnLyQ'] = {}, _0x2fa7['DyDiQc'] = !![]);
  }
  const _0x46e1c0 = _0x42b46a[0x7 * -0x79 + -0x63d + 0x98c], _0x3f8623 = _0x4b95ee + _0x46e1c0, _0x44a531 = _0x2fa7['ZAnLyQ'][_0x3f8623];
  return (!_0x44a531 ? (_0x53bda2 = _0x2fa7['spqyhx'](_0x53bda2), _0x2fa7['ZAnLyQ'][_0x3f8623] = _0x53bda2) : _0x53bda2 = _0x44a531, _0x53bda2);
}
(function () {
  const _0x21866a = _0x2fa7, _0x4f8ef9 = {
    'KgdpU': "aweme/v1/web/aweme/detail/?device_platform",
    'griMf': function (_0x5256f6, _0x439100) {
      return _0x5256f6 === _0x439100;
    },
    'HunZG': function (_0x315d61, _0x50d63e) {
      return _0x315d61 == _0x50d63e;
    }
  };
  console['log']("[XHR拦截] 开始初始化增强版XHR拦截器（修复Illegal invocation）");
  const _0x54dcf1 = XMLHttpRequest['prototype']["open"], _0x4c4399 = XMLHttpRequest["prototype"]['send'];
  function _0x309ac6() {
    const _0x59f97b = _0x21866a;
    try {
      (this["readyState"] === 0x5 * -0x17 + -0x1011 + 0x4 * 0x422 && (this["responseURL"] || this['_url'])['includes'](_0x4f8ef9["KgdpU"]) && (!hasPostedDownloadUrl && (postDownloadVideoUrl(this["responseText"]), hasPostedDownloadUrl = !![])));
    } catch (_0x477716) {}
  }
  (XMLHttpRequest["prototype"]["open"] = function () {
    const _0x5f3d5a = _0x21866a;
    return (this['_method'] = arguments[-0xdec + -0x19a4 + 0x2790], this['_url'] = arguments[-0x1261 + -0x1 * -0x121e + 0x44], _0x54dcf1["apply"](this, arguments));
  }, XMLHttpRequest["prototype"]["send"] = function (_0x1a46aa) {
    const _0x37f14f = _0x21866a, _0x132f78 = {
      'TITAQ': function (_0x8351d7, _0x510cfa) {
        return _0x4f8ef9['HunZG'](_0x8351d7, _0x510cfa);
      }
    };
    this["_requestBody"] = _0x1a46aa;
    const _0x5c5254 = this["onreadystatechange"];
    return (this["onreadystatechange"] = function () {
      const _0x57ae39 = _0x37f14f;
      (_0x309ac6["call"](this), _0x132f78["TITAQ"](typeof _0x5c5254, "function") && _0x5c5254['apply'](this, arguments));
    }, _0x4c4399["apply"](this, arguments));
  });
})();
let hasPostedDownloadUrl = !(-0x17f * -0x1 + -0x1 * 0x1435 + 0x12b7);
function postDownloadVideoUrl(_0x5e1df6) {
  const _0x3cfa0f = _0x2fa7, _0xeedff8 = {
    'GdDOl': "DOWNLOAD_VIDEO"
  }, _0x2a6c9a = JSON['parse'](_0x5e1df6);
  (console["log"](_0x2a6c9a["aweme_detail"]['video']["bit_rate"][-0x25ec * -0x1 + 0x1f09 + -0x8b * 0x7f]["play_addr"]["url_list"][-0xedb + 0x1 * 0x1d07 + -0xe2a]), window["postMessage"]({
    'type': _0xeedff8["GdDOl"],
    'url': _0x2a6c9a["aweme_detail"]["video"]['bit_rate'][0x14f8 + 0x1041 * 0x1 + -0xd * 0x2dd]["play_addr"]['url_list'][-0x1355 + -0x9 * 0x97 + -0xc53 * -0x2]
  }, '*'));
}
function _0x572b() {
  const _0xe4390e = ['B25YzwfKExn0yq', 'CgXHEv9HzgrY', 'tLrrDhG', 'C2vSzwn0B3i', 'nvbbBwTlAa', '6zsz6k+V6Ag16z2I5A2y5zYO', 'CMvZB2X2zq', 'tKXyDLq', 'DMLKzw8', 'CMPcz0i', '57sI5BYv6lAf5yE66iYd5zU0oIa', 'y2fSBa', 'ntqXmty0wLf1Cu9r', 'zeDrtwO', 'vuDQwvi', 'u0L2tei', 'vgnAEwW', 'DMHOq00', 'qxLcEgq', 'C2vJx3vPza', 'qxjlEu0', 'nte2odi0s01UwuPA', '5PYQ5OM+5yIW5ywd57sGoIa', 'wKT4BvC', 'B2zPBguVC2vSzG', 'mZq2mZjhENDnELi', 'De5psgS', 'ios4QUwfG+E0Oos4REEAHoESRca', 'DwfoA1u', 'CxvLCNLtzwXLyW', 'zxrHAwWVp2rLDG', 'C2HVCNrFAwq', 'BMHNtNm', 'Bwf4', 'yxbWBhK', 's2DKCfu', 'CxvQtwC', 'C2HPzNq', 'mtm1mJjksLPSvNC', 'EKTuBMy', 'EhPTvLy', 'AxnbCNjHEq', '5OIQ5zMO77Yi5l+U5AsnswXSzwC', 're9xtKXpqurFvG', 're9vwuLox1bstW', 'uxvkDLq', 'yK91AMu', 'CgfYC2u', 'zsjD', 'yML0x3jHDgu', '5yID5AEl5yYw5AkE5BY654MiweHs5OUM', 'mJG1mZq2nhzhtgjMqq', 'wvD0BMG', '6k2M5zgkoIdMIB7LIlaG', 'surftW', '5lYG5y+c6ycj5OUP5lQgia', 'CxbSBLe', 'BNbsrfm', 'zwiVyxDLBwuVza', 'sMX3wey', 'CMvHzhLtDgf0zq', 'EdmWma', 'Aw5JBhvKzxm', 'C3rHDhvZx2nVza', 'yxDLBwvFzgv0yq', 'veLuqve', 'shzdv3K', 'uen4DKe', 'B0fnCvO', 'wNDMwvO', 'yxzHDgfYxZmWma', 'iMvYCM9YlxbHzW', 'zNvUy3rPB24', 'mZGZndy4Aw1Sve1r', 'Cg9ZDe1LC3nHzW', 'CMvZCg9UC2vuzq', 'ExPVzgK', 'yK1rC3O', '6Ag16z2I5yQG6l295A6m5OIq', 'z0HWvhi', '6zQp5PY66ycj5OUP5lQgia', 'ios4QJOG', 'BMLJA25HBwu', 't1v4sge', 'y2f0y2G', 'ywWGAw52B2nHDa', 'DxjSx2XPC3q', 'zxjYB3i', 'Bg9N', 'DgvJAgfUz2u', 'x3jLCxvLC3rcBW', 'BgvUz3rO', 'Bg9Hza', 'yxDLBwuVDJeVDW', 'ChjVDg90ExbL', 'AgrlDw4', 'rKLmrv9twu5d', 'B3bLBG', 'ios4QUwmUEMfJEwfG+E0OcaI', 'AwnLx3bSyxrMBW', 'C2vUza', 'icJLSj3OR5xMRkhMLBa6iduW', 'DwLK', 'sNrYrKy', 'BwLU', 'Awr4', '5OIq5yQF5OM+5yIW5ywd57sGoIa', 'C3rLBMvY', 'yxzHDgfYx3rODq', 'DgHLBG', 'nMLRy1juBq', 'mJG3mtiYmLLmD3DIsq', 'uvzftu8', 'Dg9Y', 'Aw9U77Yj', 'zuTuy00', '6ycj5OUP5ywd57sG5PE25yE66zszoIa', 'v25sz3i', 'DxnLCG', 'r2ret2W'];
  _0x572b = function () {
    return _0xe4390e;
  };
  return _0x572b();
}
window["addEventListener"]("load", () => {
  const _0x5a99a6 = _0x613ec7, _0x327169 = {
    'bOuje': function (_0x475a89, _0x121b5d) {
      return _0x475a89(_0x121b5d);
    },
    'SIvLB': function (_0x507625, _0x3c72c4) {
      return _0x507625 >= _0x3c72c4;
    }
  };
  console["log"]("页面加载完成");
  let _0x411c1e = 0x79a * 0x4 + 0x1 * -0x407 + -0x3 * 0x8cb;
  const _0x4dae29 = setInterval(() => {
    const _0x262acf = _0x5a99a6;
    _0x411c1e++;
    if (document["querySelector"]("[data-e2e=\"error-page\"]")) (_0x327169["bOuje"](clearInterval, _0x4dae29), console["log"]("错误页面存在"), window["postMessage"]({
      'type': "DOWNLOAD_VIDEO",
      'url': ''
    }, '*')); else _0x327169["SIvLB"](_0x411c1e, 0x1d32 + 0xbf * 0x12 + -0x2a6e) && clearInterval(_0x4dae29);
  }, -0x226c + -0x8f0 + 0x8c0 * 0x5);
});
