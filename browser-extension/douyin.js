/**
 * AI module map
 * Purpose: isolated-world bridge for the supplied Douyin player-download workflow.
 * Entry: manifest content script on Douyin frames; receives DOWNLOAD_VIDEO from the page script.
 * Flow: saves downloaded URLs in chrome.storage.local and forwards VIDEO_OPENED_TO_BACK to the background.
 * State: URL flags and sessionStorage identify dedicated URL-fetching tabs; only those tabs follow the delayed close path.
 * Boundary: page DOM extraction belongs to douyin_content.js; ordinary browsing tabs remain open.
 */
function _0x2b70() {
  const _0x37b94d = ['ChjVzMLSzq', 'mtu2mty0nfz1y3jVAa', 'u1Loq19quK9gsq', 'Bg9JywW', 'rurFve9FqKfdsW', 'shj0tLu', 'v0PXAwq', 'zg91EwLUlMPZia', 'AgfZAa', '5ywZ6zET5Qch562+6Ag15AsX6lsLoG', 'zxjYB3i', 'Aw5JBhvKzxm', 'ndrWrwXyuhu', 'vwrmyLu', 'AxnvCMXgzxrJAa', 'CKPQqxC', 'Bg9JyxrPB24', 'ChvZAa', 'ndGWmtu2wKTluKHJ', 'surftW', 'mtGZmJuWnJbUvxLgr1a', 'zgf0yq', '6l+z5PIV6i635y+wvvjm55Qe5Qch562+', 'C2vUze1LC3nHzW', 'zg93BMXVywrLza', 'CNvUDgLTzq', 'tevFve9FrevtsW', 'mJjjCNflv1q', 'z2v0sxrLBq', 'ohvuDeD5Dq', 'vMLKzw9Z', 'C3rLBMvY', 'mZmWneT0A0HkAq', 'C3rVCMfNzq', '5ywZ6zET6i635y+wvvjm55Qe5Qch562+', 'mJK0ndm1zxbzDvzb', 'y2XVC2u', 'DxjSx2zLDgnOpq', 'Aw5NvgfI', 'DhLWzq', 'vKLeru9Ft1bftG', 'ywrKrxzLBNrmAq', 'mtaWBeXKDM5h', '5yQG6l295lQg', 'DxjS', 'ndy1nKHTvxHfAG', 're9xtKXpqurFvG', 'mJe5otnYCfn6zNa', 'nJGYmdG2whPQEwXm', 'mJb3yw1gvK8', 'z2v0', 'C2v0', 'Bg9N', 'Dhj1zq'];
  _0x2b70 = function () {
    return _0x37b94d;
  };
  return _0x2b70();
}
const _0xdd86df = _0x48ab;
function _0x48ab(_0x318e8c, _0x253d92) {
  _0x318e8c = _0x318e8c - (0x2047 + 0x1f9d * -0x1 + 0x37 * 0x1);
  const _0x38aec0 = _0x2b70();
  let _0xaf11a7 = _0x38aec0[_0x318e8c];
  if (_0x48ab['PnaSyR'] === undefined) {
    var _0x5228f4 = function (_0x166ce5) {
      const _0x1d2d75 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
      let _0xce51eb = '', _0x17320a = '';
      for (let _0x1aab56 = 0x76d + -0xc4d + 0x4e0, _0x16a808, _0x5784bf, _0x3629f3 = 8157 + -0x1fdd * 0x1; _0x5784bf = _0x166ce5['charAt'](_0x3629f3++); ~_0x5784bf && (_0x16a808 = _0x1aab56 % (0x128c + -0x3 * -0x6d6 + -0x270a) ? _0x16a808 * (0x2eb + 0xb5 * 0x7 + 0x27 * -0x32) + _0x5784bf : _0x5784bf, _0x1aab56++ % (0xd7d * -0x1 + -0x1a84 + -0x2805 * -0x1)) ? _0xce51eb += String['fromCharCode'](0x45 * 0x71 + 0x15b0 + -0x2 * 0x1993 & _0x16a808 >> (-(-0x1 * -0xe33 + -0x1850 + 0xa1f) * _0x1aab56 & -0xe8f * -0x1 + -0x14fb + 0x672)) : 0xacd + 0x6a7 * -0x2 + 0x281) {
        _0x5784bf = _0x1d2d75['indexOf'](_0x5784bf);
      }
      for (let _0xd81195 = -0x9cd * 0x3 + -0x203 * 0xd + -0x1a * -0x223, _0x5e729e = _0xce51eb['length']; _0xd81195 < _0x5e729e; _0xd81195++) {
        _0x17320a += '%' + ('00' + _0xce51eb['charCodeAt'](_0xd81195)['toString'](-0x35 * 0x39 + 0x211a + -0x153d))['slice'](-(-0xc8f + 0x5c9 * -0x2 + -0xa7 * -0x25));
      }
      return decodeURIComponent(_0x17320a);
    };
    (_0x48ab['leTozi'] = _0x5228f4, _0x48ab['kgyrVo'] = {}, _0x48ab['PnaSyR'] = !![]);
  }
  const _0x965472 = _0x38aec0[0x2369 + 0x1f * 0xef + -0x202d * 0x2], _0xc93e11 = _0x318e8c + _0x965472, _0x1a0ee7 = _0x48ab['kgyrVo'][_0xc93e11];
  return (!_0x1a0ee7 ? (_0xaf11a7 = _0x48ab['leTozi'](_0xaf11a7), _0x48ab['kgyrVo'][_0xc93e11] = _0xaf11a7) : _0xaf11a7 = _0x1a0ee7, _0xaf11a7);
}
((function (_0x47a65a, _0x15c92f) {
  const _0x455178 = _0x48ab, _0x473e3d = _0x47a65a();
  while (!![]) {
    try {
      const _0x405976 = -parseInt("21993rpSzfp") / (-0x47 * 0x1d + -0x9b * -0x16 + -0x546) * (parseInt("22IrqKWT") / (-0x1cb9 + -0x1a * 0xfd + 0x1 * 0x366d)) + parseInt("682086XzjylL") / (-0x8fb + 0x59 * -0x1e + 0x4db * 0x4) * (-parseInt("8uTtGyu") / (0x22a7 + 0x1 * 0x26d4 + -0x3 * 0x187d)) + parseInt("20wamFVO") / (-0x2 * 0x53d + -0x1dd6 + 0x2855) * (-parseInt("480156ZKKRHc") / (-0x51b * 0x7 + 0x1985 * 0x1 + 0xa3e)) + -parseInt("3304KtkHJi") / (0x154b + -0x1bb * 0x13 + 0xb9d) * (parseInt("4656HmUxEj") / (-0x810 + -0x23d6 + 0x2bee)) + parseInt("294435epYuVA") / (0x1 * -0xb45 + -0x1cf5 + 0x2843) * (-parseInt("100lLdvnG") / (0x721 + -0x32 * 0x4e + -0x825 * -0x1)) + parseInt("44pElXPu") / (-0x7ea * 0x2 + 0x3 * 0x141 + 0xc1c) * (parseInt("1561644Vucroh") / (-0x153 + 0x18bb + 0x256 * -0xa)) + parseInt("18325060nUyFGP") / (0x1e4b + 0xd7 * 0x5 + -0x3 * 0xb7b);
      if (_0x405976 === _0x15c92f) break; else _0x473e3d['push'](_0x473e3d['shift']());
    } catch (_0x37e5bc) {
      _0x473e3d['push'](_0x473e3d['shift']());
    }
  }
})(_0x2b70, -0x1de00 + -0x1ec2e + 0x2d913 * 0x3), console["log"]("douyin.js 加载了"));
let isUrlFetchingTab = !(-0xc8f + 0x5c9 * -0x2 + -0xc11 * -0x2);
(window["location"]['search']["includes"]("url_fetch=true") || window["location"]["hash"]['includes']("url_fetch=true") || sessionStorage["getItem"]("isUrlFetchingTab") === "true") && (isUrlFetchingTab = !![], console["log"]("这是获取URL的标签页"));
window["addEventListener"]('message', async _0x318e8c => {
  const _0x28be1e = _0xdd86df, _0x253d92 = {
    'UdLbU': "downloadedVideos",
    'rJjAw': "关闭获取URL的标签页",
    'HrtNU': function (_0x38aec0, _0xaf11a7) {
      return _0x38aec0 === _0xaf11a7;
    }
  };
  if (_0x318e8c["data"]["type"] === "DOWNLOAD_VIDEO") {
    (chrome["storage"]["local"]["get"](_0x253d92["UdLbU"], _0x5228f4 => {
      const _0x3b4406 = _0x28be1e, _0x965472 = _0x5228f4["downloadedVideos"] || [];
      (_0x965472["push"](_0x318e8c['data']['url']), chrome["storage"]["local"]["set"]({
        'downloadedVideos': _0x965472
      }));
    }), chrome["runtime"]["sendMessage"]({
      'type': "VIDEO_OPENED_TO_BACK",
      'url': _0x318e8c["data"]["url"]
    }), await new Promise(_0xc93e11 => setTimeout(_0xc93e11, 0x2369 + 0x1f * 0xef + -0xaa9 * 0x6)));
    try {
      isUrlFetchingTab ? (console["log"](_0x253d92["rJjAw"]), window["close"]()) : console['log']("这是正常打开的视频标签页，不关闭");
    } catch (_0x1a0ee7) {
      console["error"]("关闭标签页失败:", _0x1a0ee7);
    }
  }
});
