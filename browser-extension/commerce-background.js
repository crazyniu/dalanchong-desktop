/**
 * AI module map
 * Purpose: service-worker support for commerce-page downloads, media caches, and floating download panels.
 * Entry: imported by background.js; registers commerce runtime, network, tab, and Chrome download listeners.
 * Flow: content-script requests use Chrome downloads or page fetches; observed Douyin parameters and tab media records feed the existing commerce workflow.
 * State: this module owns its commerce caches and chrome.storage.local persistence separately from library.js session records and offscreen jobs.
 * Media cache startup is shared by readers and tab cleanup; writes coalesce bursts and passive duplicate responses leave records unchanged.
 * Boundary: keep its page-message protocols and supplied commerce implementation intact; media-records.js limits capture to Douyin and its commerce pages.
 * Side effects: browser downloads, tab messages, platform requests, and local extension storage.
 */
// Service-worker support for commerce-page downloads and floating video panels.
import {canCaptureSource, mediaSize} from './media-records.js';
import {videoPage} from './platforms.js';
import {mediaType, probeMediaFile} from './media.js';
const _0x99078e = _0x44e0;
(function (_0x369ca9, _0x10e520) {
  const _0x4c75a5 = _0x44e0, _0x1ab9b4 = _0x369ca9();
  while (!![]) {
    try {
      const _0x33455d = -parseInt("1262252ojiFcl") / (0x123b + 0x5 * -0x762 + -0x4 * -0x4ac) + -parseInt("2015264toyBaL") / (0x7ca + 0x129 * 0x9 + -0x1239) + -parseInt("2128443EnaKJU") / (0x14a3 + -0x265a + -0x8dd * -0x2) + -parseInt("2070036AWLpxg") / (-0x1ee8 + 0x7 * -0x1c + 0x2a4 * 0xc) + parseInt("693865fITHoS") / (0x4a * -0x43 + -0x1 * -0x2232 + -0x11 * 0xdf) * (parseInt("24UhVauz") / (0x69 * -0x1b + -0x8c + 0xba5)) + -parseInt("4593533uFPOMH") / (-0x1e8b + -0x10 * -0x11f + 0xca2) + -parseInt("3352FhEJSW") / (-0xc50 + 0x9f * -0x35 + 0x2d43) * (-parseInt("91404ugDvdN") / (-0x8 * 0xe9 + -0x66a * 0x6 + 0x2dcd));
      if (_0x33455d === _0x10e520) break; else _0x1ab9b4['push'](_0x1ab9b4['shift']());
    } catch (_0x416124) {
      _0x1ab9b4['push'](_0x1ab9b4['shift']());
    }
  }
})(_0x1c4a, 0x8ce4 * 0xb + -0x16 * -0xaccd + -0xb3 * 0xf8d);
async function downloadFile(_0x4bab66, _0x167734, _0x355836) {
  const _0x5e3ada = _0x44e0, _0x449f3c = {
    'cXDVr': " 到文件夹: ",
    'XNRyH': function (_0x4c53e5, _0x413e8e) {
      return _0x4c53e5 + _0x413e8e;
    },
    'uzQDj': "下载URL: ",
    'SQoTQ': "无效的下载URL: ",
    'vDqYe': function (_0x3ab30f, _0x3cd2b7) {
      return _0x3ab30f + _0x3cd2b7;
    },
    'BGmWj': "文件下载任务已创建，下载ID: ",
    'DCTdu': "下载文件失败:"
  };
  try {
    (console["log"]('开始下载文件:\x20' + _0x167734 + _0x449f3c["cXDVr"] + _0x355836), console['log'](_0x449f3c["XNRyH"](_0x449f3c["uzQDj"], _0x4bab66)));
    if (!_0x4bab66 || !_0x4bab66["startsWith"]("http")) throw new Error(_0x449f3c["SQoTQ"] + _0x4bab66);
    const media = await probeMediaFile(_0x4bab66, {trustedVideo: true});
    if (media.kind !== 'video') throw new Error('该地址不是可直接保存的视频文件。');
    const _0x3b9506 = {
      'url': media.url,
      'filename': _0x355836 + '/' + _0x167734,
      'saveAs': !(0x1fec + 0xfa3 * 0x1 + -0x17c7 * 0x2),
      'conflictAction': "uniquify"
    }, _0x48adcc = await chrome["downloads"]["download"](_0x3b9506);
    return (console["log"](_0x449f3c["vDqYe"](_0x449f3c['BGmWj'], _0x48adcc)), _0x48adcc);
  } catch (_0x3493a8) {
    console["error"](_0x449f3c["DCTdu"], _0x3493a8);
    throw _0x3493a8;
  }
}
const DOUYIN_PARAM_CACHE = [], DOUYIN_PARAM_IGNORED_KEYS = new Set(['a_bogus', 'fp', "verifyFp", 'msToken']), DOUYIN_DETAIL_PATTERN = "https://*.douyin.com/aweme/v1/web/*", DOUYIN_PARAM_CACHE_STORAGE_KEY = "param_cache", DOUYIN_MESSAGE_TYPES = {
  'DOWNLOAD_VIDEO_REQ': "DOWNLOAD_VIDEO_REQ",
  'DOWNLOAD_VIDEO_RESP': "DOWNLOAD_VIDEO_RESP",
  'DOWNLOAD_STATUS': "DOWNLOAD_STATUS",
  'ERROR_FIND_VID_REQ': "ERROR_FIND_VID_REQ",
  'FETCH_AWEME_DETAIL_REQ': "FETCH_AWEME_DETAIL_REQ"
}, DOUYIN_SNACKBAR_TEXT = {
  'parseInformation': "正在解析信息",
  'parseInformationFail': "解析视频信息失败，请刷新页面并重试",
  'startDownload': "开始下载",
  'completeDownload': "下载完成",
  'downloadFailed': "下载失败，请刷新页面重试"
}, GENERIC_VIDEO_MESSAGE_TYPES = {
  'LIST_REQ': "GENERIC_VIDEO_LIST_REQ",
  'CLEAR_REQ': "GENERIC_VIDEO_CLEAR_REQ",
  'DOWNLOAD_ITEM_REQ': "GENERIC_VIDEO_DOWNLOAD_ITEM_REQ"
}, GENERIC_MEDIA_BY_TAB_ID = new Map(), GENERIC_MEDIA_STORAGE_KEY = "generic_medias", GENERIC_MEDIA_MAX_ITEMS = -0x10b8 + -0x1b7 * 0x2 + 0x1476;
let isDouyinParamCacheRestored = ![];
let genericMediaRestore;
async function saveDouyinParamCache() {
  const _0x2f5a03 = _0x99078e;
  try {
    await chrome["storage"]["local"]["set"]({
      [DOUYIN_PARAM_CACHE_STORAGE_KEY]: DOUYIN_PARAM_CACHE["slice"](-0x4 * -0x2f3 + 0x2165 + -0x1 * 0x2d31, 0x1 * 0xd85 + -0x16a2 + 0xd5 * 0xb)
    });
  } catch (_0x1f97f7) {}
}
async function restoreDouyinParamCache() {
  const _0x7c8c5f = _0x99078e, _0x4767df = {
    'QCZmU': function (_0x5172f1, _0x338eff) {
      return _0x5172f1 !== _0x338eff;
    },
    'gMIBW': function (_0xb29c5f, _0x144b02) {
      return _0xb29c5f > _0x144b02;
    }
  };
  if (isDouyinParamCacheRestored) return;
  isDouyinParamCacheRestored = !![];
  try {
    const _0x57eb62 = await chrome['storage']["local"]["get"]([DOUYIN_PARAM_CACHE_STORAGE_KEY]), _0x51de0a = _0x57eb62[DOUYIN_PARAM_CACHE_STORAGE_KEY];
    if (!Array["isArray"](_0x51de0a)) return;
    (_0x51de0a["forEach"](_0x5823a6 => {
      const _0x38e2a9 = _0x7c8c5f;
      if (!_0x5823a6 || _0x4767df["QCZmU"](typeof _0x5823a6['time'], 'number') || !Array['isArray'](_0x5823a6["params"])) return;
      !DOUYIN_PARAM_CACHE["some"](_0x841747 => _0x841747["time"] === _0x5823a6["time"]) && DOUYIN_PARAM_CACHE['push'](_0x5823a6);
    }), DOUYIN_PARAM_CACHE["sort"]((_0x97788c, _0x2adb63) => _0x2adb63["time"] - _0x97788c["time"]), _0x4767df["gMIBW"](DOUYIN_PARAM_CACHE["length"], 0x9 * 0x1f1 + 0x5f2 + -0x1707) && DOUYIN_PARAM_CACHE["splice"](0x1 * -0x1aaa + -0x2b * 0x2f + 0x22f3));
  } catch (_0x2d74b3) {}
}
function rememberDouyinDetailParams(_0x15555b) {
  const _0x189b7a = _0x99078e, _0x2327e9 = {
    'tRTOF': "extension://",
    'VmMsN': function (_0x3f6072, _0x43b391) {
      return _0x3f6072 < _0x43b391;
    },
    'puWzY': function (_0x15b2d9, _0x33c3e7) {
      return _0x15b2d9 > _0x33c3e7;
    }
  };
  if (!_0x15555b || !_0x15555b["url"] || _0x15555b["url"]["includes"]("chrome-extension://")) return;
  if (_0x15555b["initiator"] && _0x15555b['initiator']["includes"](_0x2327e9["tRTOF"])) return;
  let _0x4d7b56;
  try {
    _0x4d7b56 = Array["from"](new URL(_0x15555b['url'])["searchParams"]['entries']());
  } catch (_0xc5c164) {
    return;
  }
  if (_0x2327e9['VmMsN'](_0x4d7b56['length'], 0x3a5 + -0x1 * 0x1922 + 0x15a0)) return;
  (DOUYIN_PARAM_CACHE["unshift"]({
    'time': Date["now"](),
    'params': _0x4d7b56
  }), _0x2327e9["puWzY"](DOUYIN_PARAM_CACHE["length"], 0x1f * 0xb1 + -0x1ce1 + 0x7d6) && DOUYIN_PARAM_CACHE['splice'](0x118b + 0x1 * 0xe7d + -0x1fa4), saveDouyinParamCache());
}
function sanitizeDownloadName(_0x5767be) {
  const _0xbbcf6c = _0x99078e, _0x51ce35 = {
    'gcViR': function (_0x26c2fd, _0x5cc32a) {
      return _0x26c2fd(_0x5cc32a);
    },
    'WtpbQ': function (_0x457f2a, _0x439dd6) {
      return _0x457f2a || _0x439dd6;
    }
  };
  return _0x51ce35["gcViR"](String, _0x51ce35['WtpbQ'](_0x5767be, ''))["replace"](/[<>:"/\\|?*\n]+/g, '\x20')["replace"](/[\u200B-\u200D\uFEFF\u200C\u2028\u2029\u200E\u200F\u000B]/g, '\x20')["replace"](/\s+/g, '\x20')['trim']();
}
function ensureFilenameExtension(_0x562294, _0x56a80d) {
  const _0x2b0d00 = _0x99078e, _0x14be63 = {
    'hwPYA': 'video',
    'CzKsn': function (_0x408944, _0x240b0a) {
      return _0x408944(_0x240b0a);
    },
    'HWuYP': "mp4",
    'Mjmvz': function (_0x23dd8f, _0x1cee42) {
      return _0x23dd8f + _0x1cee42;
    }
  }, _0x1bd8b0 = sanitizeDownloadName(_0x562294) || _0x14be63["hwPYA"], _0x8907c5 = _0x14be63['CzKsn'](sanitizeDownloadName, _0x56a80d || "mp4")['replace'](/^\.+/, '') || _0x14be63["HWuYP"];
  if (new RegExp(_0x14be63['Mjmvz']('\x5c.' + _0x8907c5, '$'), 'i')['test'](_0x1bd8b0)) return _0x1bd8b0;
  return _0x14be63["Mjmvz"](_0x1bd8b0['replace'](/\.[a-z0-9]{2,5}$/i, ''), '.') + _0x8907c5;
}
function buildDouyinDetailUrl(_0x5459f5, _0x28a097) {
  const _0xe857e6 = _0x99078e, _0x3e5e5f = {
    'OnrGE': function (_0x558bcc, _0x22b3a4) {
      return _0x558bcc === _0x22b3a4;
    },
    'iykiI': "aweme_id",
    'ratCO': "https://www.douyin.com/aweme/v1/web/aweme/detail/"
  }, _0x5ce755 = new URL(_0x3e5e5f["ratCO"]);
  return (_0x28a097['forEach'](([_0x4a8417, _0x3a8932]) => {
    const _0x34232a = _0xe857e6;
    _0x3e5e5f['OnrGE'](_0x4a8417, _0x3e5e5f['iykiI']) ? _0x5ce755["searchParams"]["append"](_0x3e5e5f["iykiI"], _0x5459f5) : _0x5ce755["searchParams"]['append'](_0x4a8417, _0x3a8932);
  }), !_0x5ce755["searchParams"]["has"](_0x3e5e5f["iykiI"]) && _0x5ce755["searchParams"]["append"]("aweme_id", _0x5459f5), _0x5ce755["toString"]());
}
function delay(_0x2e0794) {
  return new Promise(_0x3a128d => setTimeout(_0x3a128d, _0x2e0794));
}
function waitForDouyinParams(_0x39b56f) {
  const _0x7caa9f = _0x99078e;
  return DOUYIN_PARAM_CACHE["length"] > 0x243d * -0x1 + 0x11 * 0x18 + 0x22a5 ? Promise["resolve"]() : delay(_0x39b56f);
}
function buildDouyinRefreshUrl(_0x14eb6f, _0x53f762) {
  const _0x529c8d = _0x99078e;
  return buildDouyinDetailUrl(_0x14eb6f, _0x53f762["filter"](([_0x311db9]) => !DOUYIN_PARAM_IGNORED_KEYS["has"](_0x311db9)));
}
async function requestDouyinPageFetch(_0x25430d, _0x404ac3) {
  const _0x48a221 = _0x99078e;
  try {
    let _0x58ec57 = _0x404ac3;
    if (!_0x58ec57) {
      const _0x2f294c = await chrome["tabs"]["query"]({
        'active': !![],
        'lastFocusedWindow': !![]
      });
      if (!_0x2f294c["length"] || !_0x2f294c[-0x1745 + 0x90d * 0x4 + -0xcef]['id']) return;
      _0x58ec57 = _0x2f294c[10784 + -0x2a20]['id'];
    }
    await chrome["tabs"]["sendMessage"](_0x58ec57, {
      'type': DOUYIN_MESSAGE_TYPES["FETCH_AWEME_DETAIL_REQ"],
      'data': {
        'url': _0x25430d
      }
    });
  } catch (_0xadcff3) {
    chrome['runtime']["lastError"];
  }
}
async function fetchDouyinAwemeDetail(_0x23e8c2, _0x26814e) {
  const _0x3886a5 = _0x99078e, _0xdcd522 = {
    'HkfMY': function (_0x4c4b0e, _0x5d78bd, _0x49b200) {
      return _0x4c4b0e(_0x5d78bd, _0x49b200);
    }
  };
  (await restoreDouyinParamCache(), await waitForDouyinParams(0x2419 + 0x83 * 0xa + -0x280b));
  for (let _0x8d970 = 0xd * 0xbd + -0x249a + 0x1b01; _0x8d970 < 12279 + -0x1 * 0x2fed; _0x8d970++) {
    const _0x18852f = DOUYIN_PARAM_CACHE["slice"]()["sort"]((_0x3ca2ee, _0x38f471) => _0x38f471["time"] - _0x3ca2ee["time"])[-0x20 * 0xac + 0x1472 + 0x10e];
    if (!_0x18852f) {
      await waitForDouyinParams(0xc * 0x5f + -0x2660 + 0x22b4);
      continue;
    }
    const _0x13cd96 = _0xdcd522["HkfMY"](buildDouyinDetailUrl, _0x23e8c2, _0x18852f["params"]);
    try {
      const _0x10aa16 = await fetch(_0x13cd96, {
        'credentials': "include"
      });
      if (!_0x10aa16['ok']) throw new Error("Douyin detail request failed: " + _0x10aa16["status"]);
      const _0x129606 = await _0x10aa16["text"]();
      if (!_0x129606) throw new Error("Douyin detail response is empty");
      const _0x71da9c = JSON["parse"](_0x129606);
      if (_0x71da9c && _0x71da9c["aweme_detail"]) return _0x71da9c["aweme_detail"];
    } catch (_0x94bfb0) {}
    (DOUYIN_PARAM_CACHE["shift"](), saveDouyinParamCache(), await requestDouyinPageFetch(_0xdcd522["HkfMY"](buildDouyinRefreshUrl, _0x23e8c2, _0x18852f["params"]), _0x26814e), await delay(0x208 + -0x15da + -0xa4d * -0x2));
  }
  return null;
}
async function sendDouyinDownloadStatus(_0x45539a, _0x4624cf, _0x5377f4, _0x28098b) {
  const _0x143853 = _0x99078e;
  try {
    let _0x46d18c = _0x45539a;
    if (!_0x46d18c) {
      const _0x311114 = await chrome["tabs"]["query"]({
        'active': !![],
        'lastFocusedWindow': !![]
      });
      if (!_0x311114["length"] || !_0x311114[-0x1 * 0x87e + 0x26dc + 0xf2f * -0x2]['id']) return;
      _0x46d18c = _0x311114[-0x2587 + -0x1 * -0x2586 + 0x1]['id'];
    }
    await chrome['tabs']["sendMessage"](_0x46d18c, {
      'type': DOUYIN_MESSAGE_TYPES["DOWNLOAD_STATUS"],
      'status': _0x5377f4,
      'data': {
        'text': _0x4624cf,
        'timeout': _0x28098b || 0x2112 + 0x5 * -0x1b8 + 0x6 * -0x2c7
      }
    });
  } catch (_0x3d09f5) {
    chrome['runtime']["lastError"];
  }
}
function getDouyinResolutionNumber(_0xd17985, _0x3cd57e) {
  const _0x208a7d = _0x99078e, _0x41c75f = {
    'AiEta': '720',
    'dRiYi': '540',
    'iFjiA': '480'
  };
  if (_0xd17985["includes"]("1440")) return -0x1 * -0xf97 + -0x1618 + 0x1 * 0xc21;
  if (_0xd17985["includes"]("1080")) return -0x1318 + 0x115f + -0x1fb * -0x3;
  if (_0xd17985['includes'](_0x41c75f["AiEta"])) return -0xda3 * -0x1 + 0x23cf + -0x2ea2;
  if (_0xd17985['includes'](_0x41c75f["dRiYi"])) return 0x1a * 0x13c + 0x7 * 0x511 + -0x4173;
  if (_0xd17985['includes'](_0x41c75f['iFjiA'])) return -0xd11 + 0x97f + 0x29 * 0x22;
  if (_0xd17985["includes"]("360")) return -0x1eb + -0x12a5 + 0x15f8;
  if (_0xd17985["includes"]('4_')) return 0xe6b + 0x205 * -0xf + 0x10 * 0x185;
  let _0x161afe = _0xd17985["match"](/(\d{3,4})_/);
  return (!_0x161afe && (_0x161afe = _0xd17985["match"](/(\d{3,4})/)), _0x161afe && _0x161afe[0x2383 + -0x3 * -0xb23 + -0x44eb] ? parseInt(_0x161afe[-0x1624 + -0x2 * -0xf0e + -0x7f7], -0x2424 + 0x202 * -0x1 + -0xbc * -0x34) : _0x3cd57e);
}
function getDouyinResolutionText(_0x5592b8) {
  const _0x18880a = _0x99078e, _0x72c808 = {
    'rQXIR': function (_0x472cc8, _0x14cd46) {
      return _0x472cc8 === _0x14cd46;
    },
    'ereFU': function (_0x5932e3, _0x1d2137) {
      return _0x5932e3 + _0x1d2137;
    }
  };
  if (_0x5592b8 === 0x1b50 + -0xd9f + 0x541 * -0x1) return '4K';
  if (_0x72c808["rQXIR"](_0x5592b8, -0x383 * -0x6 + -0x5d * 0x25 + 0xab * -0x3)) return '2K';
  return _0x72c808["ereFU"](_0x5592b8, 'P');
}
function buildDouyinVideoDownloadInfo(_0x5b6e0e) {
  const _0x3c63f9 = _0x99078e, _0xf2e463 = {
    'ffpil': function (_0x5c7276, _0x4854c8, _0xe2bd34) {
      return _0x5c7276(_0x4854c8, _0xe2bd34);
    },
    'aDdQE': function (_0x149077, _0x47a3ec) {
      return _0x149077(_0x47a3ec);
    },
    'BTZcF': function (_0x42b7f1, _0x557020) {
      return _0x42b7f1 === _0x557020;
    },
    'hkktV': function (_0x32b11b, _0x5a2338) {
      return _0x32b11b + _0x5a2338;
    },
    'GYRis': "douyin-video",
    'ULIph': "douyin/",
    'ZutBc': function (_0x1a1dd3, _0x224ff0, _0x4c32ec) {
      return _0x1a1dd3(_0x224ff0, _0x4c32ec);
    }
  };
  if (!_0x5b6e0e || !_0x5b6e0e["video"] || !Array["isArray"](_0x5b6e0e['video']["bit_rate"])) return null;
  const _0x475652 = _0x5b6e0e['video']["bit_rate"]["filter"](_0x1f3769 => _0x1f3769 && _0x1f3769["format"] === "mp4" && _0x1f3769["play_addr"] && Array["isArray"](_0x1f3769["play_addr"]["url_list"]) && _0x1f3769["play_addr"]['url_list']["length"] > -0x2f * 0x47 + -0x14bc + 0x85 * 0x41)['map'](_0x116a84 => {
    const _0x4a9023 = _0x3c63f9, _0x594ed3 = Math["min"](_0x116a84["play_addr"]["width"] || 8821 + -0x2275, _0x116a84["play_addr"]['height'] || -0x3f5 + -0x751 * 0x4 + 0x2139), _0x14e9b5 = _0xf2e463["ffpil"](getDouyinResolutionNumber, _0x116a84['gear_name'] || '', _0x594ed3);
    return {
      'bitRate': _0x116a84["bit_rate"] || 0x33 * 0x9a + 0x1b24 + -0x39d2,
      'dataSize': _0x116a84['play_addr']["data_size"] || -0x1 * -0x20b1 + -0x6 * 0x232 + -0x107 * 0x13,
      'format': _0x116a84["format"],
      'resolutionNumber': _0x14e9b5,
      'resolutionText': _0xf2e463['aDdQE'](getDouyinResolutionText, _0x14e9b5),
      'urlList': _0x116a84["play_addr"]["url_list"]["slice"]()["sort"]((_0x392213, _0x19eca7) => _0x392213["length"] - _0x19eca7["length"])
    };
  })["sort"]((_0x2189dc, _0x4ee900) => _0x2189dc["resolutionNumber"] === _0x4ee900["resolutionNumber"] ? _0x4ee900["bitRate"] - _0x2189dc["bitRate"] : _0x4ee900["resolutionNumber"] - _0x2189dc["resolutionNumber"]);
  if (_0xf2e463["BTZcF"](_0x475652["length"], -0x1622 + -0x17fe + 0x2e20)) return null;
  const _0x4a052b = Array["isArray"](_0x5b6e0e["text_extra"]) ? _0x5b6e0e["text_extra"]['filter'](_0x264627 => _0x264627 && _0x264627["hashtag_name"])['map'](_0x4d1ab3 => '#' + _0x4d1ab3["hashtag_name"]) : [];
  let _0x4187f6 = _0x5b6e0e['desc'] || '';
  _0x4a052b["forEach"](_0x338070 => {
    const _0x54feae = _0x3c63f9;
    _0x4187f6 = _0x4187f6["replace"](new RegExp(_0x338070, 'i'), '');
  });
  const _0x46c28a = _0x475652[-0x998 * 0x3 + -0x1858 + 0x3520], _0x19d4a3 = _0x5b6e0e["author"] && _0x5b6e0e["author"]['nickname'] ? _0xf2e463["hkktV"]('@', _0x5b6e0e['author']["nickname"]) : '', _0x5a0ece = sanitizeDownloadName([_0x19d4a3, _0x4187f6, _0x46c28a["resolutionText"]]['filter'](Boolean)["join"]('\x20')) || _0x5b6e0e["aweme_id"] || _0xf2e463['GYRis'];
  return {
    'url': _0x46c28a["urlList"][-0x1f4b * 0x1 + 0x8be + 0x168d],
    'filename': _0xf2e463["hkktV"](_0xf2e463["ULIph"], _0xf2e463["ZutBc"](ensureFilenameExtension, _0x5a0ece, "mp4"))
  };
}
async function downloadDouyinAwemeVideo(_0x474dc7, _0x438015) {
  const _0x432bf7 = _0x99078e, _0x33a777 = {
    'WbdvX': function (_0x5a2729, _0x54145e) {
      return _0x5a2729 !== _0x54145e;
    },
    'MaHtn': "NETWORK_FAILED",
    'yaGVs': "USER_CANCELED",
    'JnvIn': "error",
    'jCklt': function (_0x343334, _0x1877f3, _0x284dfc, _0x52dabe, _0x3855a2) {
      return _0x343334(_0x1877f3, _0x284dfc, _0x52dabe, _0x3855a2);
    },
    'GOdXY': function (_0xe66d17, _0x4be709) {
      return _0xe66d17 + _0x4be709;
    },
    'Akbkx': function (_0x26ec07, _0x14e5dd) {
      return _0x26ec07 + _0x14e5dd;
    },
    'twUFx': function (_0x5c2450, _0x1d069e) {
      return _0x5c2450(_0x1d069e);
    },
    'PXOwB': function (_0x1522f7, _0x280e48) {
      return _0x1522f7 + _0x280e48;
    }
  }, _0x561eea = _0x474dc7["data"] || ({}), _0x1dffbf = _0x438015 && _0x438015["tab"] ? _0x438015['tab']['id'] : null, _0x4a22b0 = String(_0x561eea["vid"] || _0x561eea["awemeId"] || '')['trim']();
  if (!(/^\d+$/)["test"](_0x4a22b0)) throw new Error("解析视频信息失败，未找到抖音视频ID");
  await _0x33a777['jCklt'](sendDouyinDownloadStatus, _0x1dffbf, _0x33a777["Akbkx"](DOUYIN_SNACKBAR_TEXT["parseInformation"] + '\x0a', _0x4a22b0), "info", 0x32d + -0x3b + 0x4de);
  const _0x243a29 = await fetchDouyinAwemeDetail(_0x4a22b0, _0x1dffbf);
  if (!_0x243a29) return (await sendDouyinDownloadStatus(_0x1dffbf, _0x33a777['GOdXY'](DOUYIN_SNACKBAR_TEXT["parseInformationFail"] + '\x0a', _0x4a22b0), "error", -0x47f * -0x4 + -0xed4 + 0x12a * 0x4), {
    'type': DOUYIN_MESSAGE_TYPES["DOWNLOAD_VIDEO_RESP"],
    'success': ![],
    'error': DOUYIN_SNACKBAR_TEXT["parseInformationFail"]
  });
  const _0xe01cf9 = _0x33a777["twUFx"](buildDouyinVideoDownloadInfo, _0x243a29);
  if (!_0xe01cf9 || !_0xe01cf9["url"]) return (await sendDouyinDownloadStatus(_0x1dffbf, _0x33a777['PXOwB'](DOUYIN_SNACKBAR_TEXT["parseInformationFail"] + '\x0a', _0x4a22b0), "error", 0x20b + -0x21a1 * -0x1 + -0x1bdc), {
    'type': DOUYIN_MESSAGE_TYPES["DOWNLOAD_VIDEO_RESP"],
    'success': ![],
    'error': DOUYIN_SNACKBAR_TEXT["parseInformationFail"]
  });
  const media = await probeMediaFile(_0xe01cf9.url, {trustedVideo: true});
  if (media.kind !== 'video') throw new Error('该作品未返回可直接保存的视频文件。');
  const _0x30390a = await chrome['downloads']["download"]({
    'url': media.url,
    'filename': _0xe01cf9["filename"],
    'saveAs': ![],
    'conflictAction': "uniquify"
  });
  let _0x11bb46 = ![];
  const _0x1a189a = _0x40ec24 => {
    const _0x598499 = _0x432bf7;
    if (_0x33a777['WbdvX'](_0x40ec24['id'], _0x30390a)) return;
    if (_0x40ec24["error"]) {
      const _0xbd7724 = _0x40ec24["error"]["current"];
      if (_0xbd7724 && _0xbd7724 === _0x33a777["MaHtn"]) return;
      _0xbd7724 !== _0x33a777["yaGVs"] && sendDouyinDownloadStatus(_0x1dffbf, DOUYIN_SNACKBAR_TEXT["downloadFailed"] + '\x0a' + _0xe01cf9["filename"], _0x33a777["JnvIn"], 0x1 * 0xd47 + -0x13a6 + 0xe2f);
      chrome["downloads"]["onChanged"]["removeListener"](_0x1a189a);
      return;
    }
    if (_0x40ec24["filename"] && !_0x11bb46) {
      (_0x11bb46 = !![], _0x33a777["jCklt"](sendDouyinDownloadStatus, _0x1dffbf, _0x33a777["GOdXY"](DOUYIN_SNACKBAR_TEXT["startDownload"], '\x0a') + _0xe01cf9['filename'], "info", 0x5 * 0x26e + 0x1 * 0x9da + -0xe30));
      return;
    }
    _0x40ec24["state"] && _0x40ec24["state"]["current"] === "complete" && (_0x33a777["jCklt"](sendDouyinDownloadStatus, _0x1dffbf, DOUYIN_SNACKBAR_TEXT["completeDownload"] + '\x0a' + _0xe01cf9["filename"], "success", -0xe15 + 0x1272 + 0x373), chrome['downloads']['onChanged']["removeListener"](_0x1a189a));
  };
  return (chrome['downloads']["onChanged"]["addListener"](_0x1a189a), {
    'type': DOUYIN_MESSAGE_TYPES["DOWNLOAD_VIDEO_RESP"],
    'success': !![],
    'downloadId': _0x30390a,
    'filename': _0xe01cf9["filename"],
    'url': _0xe01cf9['url']
  });
}
function getResponseHeader(_0x5b34c3, _0x54d63e) {
  const _0x538af6 = _0x99078e;
  if (!Array["isArray"](_0x5b34c3)) return '';
  const _0x141737 = _0x54d63e["toLowerCase"](), _0x2b3f24 = _0x5b34c3["find"](_0x32c1fd => _0x32c1fd && _0x32c1fd["name"] && _0x32c1fd["name"]["toLowerCase"]() === _0x141737);
  return _0x2b3f24 && _0x2b3f24["value"] ? String(_0x2b3f24["value"])["toLowerCase"]() : '';
}
function getGenericUrlParts(_0x47c161) {
  const _0xcb7e44 = _0x99078e;
  try {
    const _0x252894 = new URL(_0x47c161), _0x4ed43a = decodeURIComponent(_0x252894["pathname"] || ''), _0x2d65fe = _0x4ed43a["split"]('/')["filter"](Boolean)["pop"]() || '', _0x5c4ef1 = _0x2d65fe["toLowerCase"]()["match"](/\.([a-z0-9]{2,5})$/);
    return {
      'host': _0x252894["hostname"],
      'name': _0x2d65fe,
      'extension': _0x5c4ef1 ? _0x5c4ef1[-0xac + 0x73f * 0x1 + 0x349 * -0x2] : ''
    };
  } catch (_0x38834a) {
    return {
      'host': '',
      'name': '',
      'extension': ''
    };
  }
}
async function isSupportedCommerceTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return canCaptureSource(tab.url) && !videoPage(tab.url);
  } catch {
    return false;
  }
}

async function notifyVideoUpdate(_0xbf20bf) {
  const _0x35c231 = _0x99078e, _0x7f6dd0 = {
    'AEQUo': function (_0x53eff4, _0x36ae64) {
      return _0x53eff4(_0x36ae64);
    }
  };
  if (!_0xbf20bf) return;
  try {
    const _0x2d8d33 = await _0x7f6dd0['AEQUo'](getGenericMediaList, _0xbf20bf);
    await chrome['tabs']["sendMessage"](_0xbf20bf, {
      'type': "GENERIC_VIDEO_UPDATE",
      'items': _0x2d8d33
    });
  } catch (_0x452a20) {
    chrome["runtime"]["lastError"];
  }
}
async function notifyVideoHide(_0x1be41d) {
  const _0x37a787 = _0x99078e, _0x1965da = {
    'MlZHH': "GENERIC_VIDEO_HIDE"
  };
  if (!_0x1be41d) return;
  try {
    await chrome["tabs"]["sendMessage"](_0x1be41d, {
      'type': _0x1965da['MlZHH']
    });
  } catch (_0x11aa14) {
    chrome["runtime"]["lastError"];
  }
}
function getGenericExtensionFromContentType(_0x4860f7) {
  const _0x13cc26 = _0x99078e, _0x1c3a10 = {
    'Bucjt': function (_0x3cbb35, _0x39e0d2) {
      return _0x3cbb35(_0x39e0d2);
    },
    'yWwdD': function (_0x2a57a6, _0x39e45b) {
      return _0x2a57a6 === _0x39e45b;
    },
    'tEIqO': "mov",
    'XhlYr': function (_0x407c77, _0x4662a8) {
      return _0x407c77 === _0x4662a8;
    },
    'PLzMf': "video/x-m4v",
    'gfvND': "m4v"
  }, _0x245d58 = _0x1c3a10['Bucjt'](String, _0x4860f7 || '')["split"](';')[-0x9ae * -0x1 + 0x12 * 0x7b + -0x1254]["trim"]()["toLowerCase"]();
  if (_0x245d58 === "video/mp4") return 'mp4';
  if (_0x245d58 === "video/webm") return "webm";
  if (_0x1c3a10["yWwdD"](_0x245d58, "video/ogg")) return 'ogv';
  if (_0x1c3a10['yWwdD'](_0x245d58, "video/quicktime")) return _0x1c3a10["tEIqO"];
  if (_0x1c3a10["XhlYr"](_0x245d58, _0x1c3a10["PLzMf"])) return _0x1c3a10["gfvND"];
  return '';
}
function normalizeGenericUrlForCompare(_0x5f54df) {
  const _0x538eee = _0x99078e, _0x16e1e4 = {
    'WhfLc': function (_0x1368a1, _0x3ac37d) {
      return _0x1368a1(_0x3ac37d);
    },
    'ByzMl': function (_0x3b4f14, _0x329478) {
      return _0x3b4f14 || _0x329478;
    }
  };
  try {
    const _0x3cb0ba = new URL(_0x5f54df);
    return (_0x3cb0ba["hash"] = '', _0x3cb0ba["toString"]());
  } catch (_0x9cf0b9) {
    return _0x16e1e4['WhfLc'](String, _0x16e1e4["ByzMl"](_0x5f54df, ''));
  }
}
function isHttpDownloadUrl(_0x1cb15) {
  const _0x183fd7 = _0x99078e, _0x37a73e = {
    'tWKez': function (_0x33cbd8, _0x15eeaa) {
      return _0x33cbd8(_0x15eeaa);
    },
    'vuadS': function (_0x2f52e2, _0x183396) {
      return _0x2f52e2 || _0x183396;
    }
  };
  return (/^https?:\/\//i)['test'](_0x37a73e["tWKez"](String, _0x37a73e["vuadS"](_0x1cb15, '')));
}
function isGenericDirectVideoUrl(url, contentType) {
  return /^https?:\/\//i.test(url) && mediaType(url, contentType) === 'video';
}

function serializeGenericMediaCache() {
  const _0x25f732 = _0x99078e, _0x1b2a7e = {};
  return (GENERIC_MEDIA_BY_TAB_ID["forEach"]((_0x5cec1c, _0x223527) => {
    const _0x2c7468 = _0x25f732;
    _0x1b2a7e[String(_0x223527)] = _0x5cec1c["slice"](-0xe56 + 0x4 * 0x376 + 0x7e, GENERIC_MEDIA_MAX_ITEMS);
  }), _0x1b2a7e);
}
let genericMediaSave, genericMediaDirty = false;
function saveGenericMediaCache() {
  genericMediaDirty = true;
  if (genericMediaSave) return genericMediaSave;
  // Network bursts share one in-flight write, followed by the latest cache state.
  genericMediaSave = (async () => {
    do {
      genericMediaDirty = false;
      await chrome.storage.local.set({[GENERIC_MEDIA_STORAGE_KEY]: serializeGenericMediaCache()});
    } while (genericMediaDirty);
  })().catch(error => console.error('保存网页视频记录失败', error))
    .finally(() => { genericMediaSave = undefined; });
  return genericMediaSave;
}
function restoreGenericMediaCache() {
  // All readers and tab cleanup await the same startup read before changing the cache.
  if (!genericMediaRestore) {
    genericMediaRestore = (async () => {
      const stored = (await chrome.storage.local.get(GENERIC_MEDIA_STORAGE_KEY))[GENERIC_MEDIA_STORAGE_KEY];
      if (!stored || typeof stored !== 'object') return;
      for (const [key, items] of Object.entries(stored)) {
        const tabId = parseInt(key, 10);
        if (!Number.isInteger(tabId) || !Array.isArray(items)) continue;
        GENERIC_MEDIA_BY_TAB_ID.set(tabId, items.filter(item => item && item.url).slice(0, GENERIC_MEDIA_MAX_ITEMS));
      }
    })().catch(error => console.error('读取网页视频记录失败', error));
  }
  return genericMediaRestore;
}
async function rememberGenericMedia(_0x4104f4) {
  const _0x4ea9cc = _0x99078e, _0x4afc45 = {
    'qaClI': "chrome-extension://",
    'TZkbW': function (_0x4d5f6d, _0x58f0c7) {
      return _0x4d5f6d(_0x58f0c7);
    },
    'TfTCb': function (_0x466b78, _0x1b0541, _0xcdea5f) {
      return _0x466b78(_0x1b0541, _0xcdea5f);
    },
    'elVJa': "content-length",
    'lRCPg': function (_0x49206d, _0x406ab8) {
      return _0x49206d < _0x406ab8;
    },
    'PmNdf': function (_0xa57cb5, _0x3e86f8, _0x4a6384) {
      return _0xa57cb5(_0x3e86f8, _0x4a6384);
    },
    'dBGxZ': "mp4",
    'fSdfb': function (_0x13bfcb) {
      return _0x13bfcb();
    }
  };
  if (!_0x4104f4 || _0x4104f4['tabId'] == null || _0x4104f4["tabId"] < 0x1c35 + 0x39 * -0xa9 + -0x324 * -0x3 || !_0x4104f4["url"] || _0x4104f4["url"]["includes"](_0x4afc45['qaClI'])) return;
  if (_0x4104f4["initiator"] && _0x4104f4["initiator"]["includes"]("extension://")) return;
  // Most page responses are scripts, styles or images. Reject them before any tabs/storage IPC.
  const _0x5e43b7 = getResponseHeader(_0x4104f4.responseHeaders, "content-type"), _0x1b0ec9 = getGenericUrlParts(_0x4104f4.url);
  if (!_0x4afc45["PmNdf"](isGenericDirectVideoUrl, _0x4104f4["url"], _0x5e43b7)) return;
  if (_0x4104f4.statusCode < 200 || _0x4104f4.statusCode >= 300) return;
  const sourceTab = await chrome.tabs.get(_0x4104f4.tabId).catch(() => null);
  if (!sourceTab || !canCaptureSource(sourceTab.url) || videoPage(sourceTab.url)) return;
  await restoreGenericMediaCache();
  if ((GENERIC_MEDIA_BY_TAB_ID.get(_0x4104f4.tabId) || []).some(item => item.url === _0x4104f4.url && item.mediaVerified)) return;
  let media;
  if (/^video\//i.test(_0x5e43b7)) {
    media = {kind: 'video', contentType: _0x5e43b7, size: mediaSize(_0x4104f4.statusCode, name => getResponseHeader(_0x4104f4.responseHeaders, name), 'video')};
  } else {
    try { media = await probeMediaFile(_0x4104f4.url); } catch { return; }
    if (media.kind !== 'video') return;
    const currentTab = await chrome.tabs.get(_0x4104f4.tabId).catch(() => null);
    if (currentTab?.url !== sourceTab.url) return;
  }
  const _0xb9b72f = {
    mediaVerified: true,
    sourceUrl: sourceTab.url,
    'url': _0x4104f4["url"],
    'tabId': _0x4104f4["tabId"],
    'frameId': _0x4104f4['frameId'],
    'type': _0x4104f4["type"] || '',
    'contentType': media.contentType,
    'contentLength': media.size,
    'extension': _0x1b0ec9['extension'] || getGenericExtensionFromContentType(_0x5e43b7) || _0x4afc45['dBGxZ'],
    'name': _0x1b0ec9['name'],
    'time': Date["now"]()
  }, _0x6e8424 = GENERIC_MEDIA_BY_TAB_ID['get'](_0x4104f4["tabId"]) || [], _0x4e065a = normalizeGenericUrlForCompare(_0xb9b72f["url"]), _0x43b249 = _0x6e8424["findIndex"](_0x3f38a9 => normalizeGenericUrlForCompare(_0x3f38a9["url"]) === _0x4e065a);
  const previous = _0x6e8424[_0x43b249];
  if (previous && Object.entries(_0xb9b72f).every(([key, value]) => key === 'time' || previous[key] === value)) return;
  (_0x43b249 >= -0xca + -0x229d + 0x39 * 0x9f && _0x6e8424["splice"](_0x43b249, 0x2504 + 0xc5 * -0xe + -0x1a3d), _0x6e8424['unshift'](_0xb9b72f), _0x6e8424["length"] > GENERIC_MEDIA_MAX_ITEMS && _0x6e8424["splice"](GENERIC_MEDIA_MAX_ITEMS), GENERIC_MEDIA_BY_TAB_ID["set"](_0x4104f4["tabId"], _0x6e8424), updateGenericMediaBadge(_0x4104f4["tabId"]), _0x4afc45['fSdfb'](saveGenericMediaCache), _0x4afc45['TZkbW'](notifyVideoUpdate, _0x4104f4["tabId"]));
}
async function clearGenericMedia(tabId) {
  if (tabId == null) return;
  await restoreGenericMediaCache();
  const removed = GENERIC_MEDIA_BY_TAB_ID.delete(tabId);
  void notifyVideoHide(tabId);
  if (removed) await saveGenericMediaCache();
}
function updateGenericMediaBadge(_0x161b94) {
  return;
}
function formatGenericMediaSize(_0x97ebe6) {
  const _0x5c20f2 = _0x99078e, _0x2c5bfb = {
    'oYnKx': function (_0x873e45, _0x12f70a) {
      return _0x873e45(_0x12f70a);
    },
    'lVYTI': function (_0x573e06, _0x10a435) {
      return _0x573e06 || _0x10a435;
    },
    'gEnEw': function (_0x3cd3eb, _0x548cd6) {
      return _0x3cd3eb <= _0x548cd6;
    },
    'GEJFr': function (_0x1d45db, _0xbacd8a) {
      return _0x1d45db * _0xbacd8a;
    },
    'qcxyG': function (_0x58b441, _0x42cfe0) {
      return _0x58b441 + _0x42cfe0;
    }
  }, _0x5ac688 = _0x2c5bfb["oYnKx"](Number, _0x2c5bfb["lVYTI"](_0x97ebe6, -0x1585 + 0x4dd + -0x34 * -0x52));
  if (!Number['isFinite'](_0x5ac688) || _0x2c5bfb['gEnEw'](_0x5ac688, 8411 + 0x20db * -0x1)) return '';
  if (_0x5ac688 >= _0x2c5bfb["GEJFr"]((-0x127b + 0x898 + -0x2c7 * -0x5) * (-0x1faf * 0x1 + 0x1581 * 0x1 + 0x42 * 0x37), -0x1649 + -0x6fd + 0x2146)) return (_0x5ac688 / (0x802 + 0x1 * -0x53a + 0x138) / (-0x98e + 0x1 * -0x4c7 + 0x13 * 0xf7) / (0xc14 * -0x1 + -0x25a2 + -0x4e2 * -0xb))["toFixed"](0x53 * -0x37 + 0x233 * -0x7 + 0x213c) + 'GB';
  return _0x2c5bfb['qcxyG']((_0x5ac688 / (0x21a3 + -0x21 * -0x7a + -0x2d5d) / (-0x153c + 0x1b85 + -0xf * 0x27))["toFixed"](12185 + -0x2f97), 'MB');
}
function getGenericMediaDisplayName(_0x26a747, _0x2d6aa0) {
  const _0x182ef3 = _0x99078e, _0x3eb057 = {
    'DLeRy': function (_0x524b49, _0x319a48) {
      return _0x524b49 + _0x319a48;
    },
    'kQLpN': "video-",
    'QSMuk': function (_0x13d2ec, _0x4fcb54) {
      return _0x13d2ec(_0x4fcb54);
    },
    'WiMKn': "mp4"
  }, _0x5922ab = _0x26a747 && _0x26a747["name"] ? String(_0x26a747["name"])['replace'](/\.[a-z0-9]{2,5}$/i, '') : '', _0x14435d = sanitizeDownloadName(_0x5922ab) || _0x3eb057['DLeRy'](_0x3eb057["kQLpN"], _0x2d6aa0 + (-0x782 * 0x3 + 0x169d + 0x2 * -0xb));
  return ensureFilenameExtension(_0x14435d, _0x26a747["extension"] || _0x3eb057["QSMuk"](getGenericExtensionFromContentType, _0x26a747["contentType"]) || _0x3eb057["WiMKn"]);
}
async function getGenericMediaList(_0xa57f2c) {
  const _0xf1e85d = _0x99078e, _0x124505 = {
    'VpyAX': function (_0xe0cc35, _0x5432f2) {
      return _0xe0cc35 == _0x5432f2;
    }
  };
  await restoreGenericMediaCache();
  const _0x3ee4a5 = _0x124505['VpyAX'](_0xa57f2c, null) ? [] : GENERIC_MEDIA_BY_TAB_ID["get"](_0xa57f2c) || [];
  const tab = _0x3ee4a5.length ? await chrome.tabs.get(_0xa57f2c).catch(() => null) : null;
  return _0x3ee4a5.filter(item => item.mediaVerified && item.sourceUrl === tab?.url && mediaType(item.url, item.contentType) !== 'audio')["map"]((_0x42047a, _0x515f0c) => ({
    'id': normalizeGenericUrlForCompare(_0x42047a['url']),
    'index': _0x515f0c,
    'url': _0x42047a["url"],
    'name': getGenericMediaDisplayName(_0x42047a, _0x515f0c),
    'size': _0x42047a["contentLength"] || 0x143 + 0x7 * 0x2e7 + -0x1594,
    'sizeText': formatGenericMediaSize(_0x42047a["contentLength"]),
    'extension': _0x42047a["extension"] || getGenericExtensionFromContentType(_0x42047a["contentType"]) || "mp4",
    'contentType': _0x42047a["contentType"] || '',
    'time': _0x42047a["time"] || 0x5e8 + -0x26c5 * 0x1 + -0x1 * -0x20dd
  }));
}
function getMessageTabId(_0x3f1767, _0x87ef23) {
  const _0x36c7a2 = _0x99078e, _0x292d04 = {
    'scmFw': function (_0x4bae77, _0x26c7ab, _0x47e3be) {
      return _0x4bae77(_0x26c7ab, _0x47e3be);
    }
  }, _0x4b100c = _0x3f1767 && _0x3f1767["data"] ? _0x3f1767["data"] : {}, _0x20a285 = _0x4b100c['tabId'] != null ? _0x4b100c["tabId"] : _0x3f1767 && _0x3f1767["tabId"], _0x1e7aba = Number["isInteger"](_0x20a285) ? _0x20a285 : _0x292d04["scmFw"](parseInt, String(_0x20a285 || ''), 0x1 * 0x1065 + 0x733 + -0x178e * 0x1);
  if (Number["isInteger"](_0x1e7aba)) return _0x1e7aba;
  return _0x87ef23 && _0x87ef23["tab"] && Number["isInteger"](_0x87ef23["tab"]['id']) ? _0x87ef23["tab"]['id'] : null;
}
async function downloadGenericMediaItem(_0x3195cc, _0x2ca269) {
  const _0x586ce2 = _0x99078e, _0xaad502 = {
    'HxSsu': '未找到当前标签页',
    'zjKZP': function (_0x2614aa, _0x1fae0d) {
      return _0x2614aa(_0x1fae0d);
    },
    'SmHLm': function (_0x26a1b2, _0x5dbd17) {
      return _0x26a1b2(_0x5dbd17);
    },
    'dArMg': 'mp4',
    'BiSSH': "video",
    'JKRRZ': function (_0x5b26e1, _0x51800b, _0x5001dd) {
      return _0x5b26e1(_0x51800b, _0x5001dd);
    },
    'ZkQJl': "uniquify"
  };
  await restoreGenericMediaCache();
  const _0x27df8a = _0x3195cc['data'] || ({}), _0x423062 = getMessageTabId(_0x3195cc, _0x2ca269);
  if (!Number["isInteger"](_0x423062)) throw new Error(_0xaad502["HxSsu"]);
  const _0x4f6fb2 = normalizeGenericUrlForCompare(_0x27df8a["url"] || ''), _0x1137f8 = GENERIC_MEDIA_BY_TAB_ID["get"](_0x423062) || [];
  let _0x356daf = _0x1137f8["find"](_0x88fc3d => normalizeGenericUrlForCompare(_0x88fc3d['url']) === _0x4f6fb2);
  if (!_0x356daf) {
    if (!_0x27df8a["directVideo"] || !isHttpDownloadUrl(_0x27df8a["url"])) throw new Error("视频地址已失效，请重新播放视频后再试");
    const _0x5ca940 = _0xaad502["zjKZP"](getGenericUrlParts, _0x27df8a["url"]);
    _0x356daf = {
      'url': _0x27df8a["url"],
      'contentType': _0x27df8a["contentType"] || '',
      'extension': _0x5ca940["extension"] || _0xaad502['SmHLm'](getGenericExtensionFromContentType, _0x27df8a["contentType"]) || _0xaad502["dArMg"],
      'name': _0x5ca940['name']
    };
  }
  if (!await isSupportedCommerceTab(_0x423062)) throw new Error('当前网页不支持视频下载。');
  const media = await probeMediaFile(_0x356daf.url, {trustedVideo: Boolean(_0x356daf.mediaVerified)});
  if (media.kind !== 'video') throw new Error('该地址不是可直接保存的视频文件。');
  const _0x5eab62 = sanitizeDownloadName(_0x27df8a["filename"] || _0x27df8a["pageTitle"] || _0x356daf["name"] || _0xaad502['BiSSH']) || _0xaad502['BiSSH'], _0x2c13d4 = "videos/" + _0xaad502["JKRRZ"](ensureFilenameExtension, _0x5eab62, _0x356daf["extension"] || getGenericExtensionFromContentType(_0x356daf["contentType"]) || _0xaad502["dArMg"]), _0x55eb18 = await chrome["downloads"]["download"]({
    'url': media.url,
    'filename': _0x2c13d4,
    'saveAs': ![],
    'conflictAction': _0xaad502['ZkQJl']
  });
  return {
    'success': !![],
    'downloadId': _0x55eb18,
    'filename': _0x2c13d4,
    'url': _0x356daf["url"]
  };
}
function initializeDouyinVideoDownloader() {
  const _0x24894c = _0x99078e;
  if (!chrome["webRequest"] || !chrome['webRequest']["onBeforeRequest"]) return;
  chrome["webRequest"]["onBeforeRequest"]["addListener"](rememberDouyinDetailParams, {
    'urls': [DOUYIN_DETAIL_PATTERN]
  });
}
function initializeGenericVideoDownloader() {
  const _0x33d80d = _0x99078e, _0x49a905 = {
    'fcxfj': 'loading',
    'Uvqvg': function (_0x157142, _0x42d779) {
      return _0x157142(_0x42d779);
    },
    'axdhs': 'complete',
    'KcDrm': "responseHeaders"
  };
  if (!chrome["webRequest"] || !chrome["webRequest"]["onResponseStarted"]) return;
  (restoreGenericMediaCache(), chrome['webRequest']["onResponseStarted"]["addListener"](rememberGenericMedia, {
    'urls': ["http://*/*", "https://*/*"]
  }, [_0x49a905["KcDrm"]]), chrome['tabs'] && chrome['tabs']["onUpdated"] && chrome["tabs"]["onUpdated"]["addListener"]((_0x6bb6a9, _0x16b97b, _0x46d263) => {
    const _0x1b5542 = _0x33d80d;
    (_0x16b97b && _0x16b97b["status"] === _0x49a905["fcxfj"] && _0x49a905['Uvqvg'](clearGenericMedia, _0x6bb6a9), _0x16b97b && _0x16b97b["status"] === _0x49a905["axdhs"] && _0x46d263 && _0x46d263["url"] && _0x49a905["Uvqvg"](notifyVideoUpdate, _0x6bb6a9));
  }), chrome['tabs'] && chrome["tabs"]["onRemoved"] && chrome['tabs']["onRemoved"]["addListener"](_0x58b37c => clearGenericMedia(_0x58b37c)));
}
function _0x1c4a() {
  const _0x351c0c = ['ywrLCNm', 'lcdNMB3LKi3LJzvJB29RAq', 'iowKSEI0PtO', 'DevjCu8', 'mZm1mKzOruPtvW', 'ChjVyMuGDgLTzq', 'DxLer0W', 'Ahr0Chm6lY8QlW', 'B3uUy29T', 'Dw5KzwzPBMvK', 'AxLbA1q', 'y1HevNi', 'Bxa0', 'D3mTA2vLCgfSAq', 'y2fUBM90ihn5BG', 'thPUuuO', 'B2fK', 'C2XPy2u', '5Q2J5zYO6kEJ5P6q5l+H5OgV', 'mJaXnti2nhrVEujHta', 'EuPvvMy', 'vgDtu3O', 'rwrWq0C', 'BsbKzxnRDg9W', 'zMLUywXSEq', 'Bg9N', 'zg93BMXVywrjza', 'mti2mJi1mM9QAuzJBa', 'DxPrrgO', 'zg91EwLUlW', 'vu95DMu', 'AMXfA3i', 'uejyAMu', 'C3rYAw5NAwz5', 'yML0x3jHDgu', 'w2f1Dg9tyxzLxq', 'CMvHzhLtDgf0zq', 'y2XVC2u', 'u1fVvfe', 'Dfjut0y', 'zMzWAwW', 'D2nwA2m', 'DhLWzq', 'ignVB2TPzxmSia', 'ufnnCLi', 'CMvZB2X2zq', 'A3rPBwu', '5y+r6ycb5RAi5OgV5yIW5Qch562+6Ag1ia', 'kI5QAw5YAxrLBq', 'vvDgq2u', 'Dg9gAxHLza', '5lIl6l29vvjmoIa', 'Au9dCM4', 'yxDLBwvFzgv0yq', 'ChvxELK', 'Aw5PDgLHDg9Y', 'AgTRDfy', 'B25TzxnZywDL', 'uNjhDva', 'revpx0Xju1rFuG', '6kEg6Akr5zYW5z2a5BEY5AsX5Pwi77Ym6k+36yEn', 'AwXSihjLy29UBG', 'Dg9mB2nHBgvuAq', 'C3rHDhvZ', 'zgLHCW', '5Qch562+6Ag15yIB5BU65OIq5yQFoG', 'Aw4Uy29TlYO', '5PEG5z+F5zcn', 'x19KzwzHDwX0xW', 'DcbZEw5JihjLCq', 'sgTuBMK', 'C3bSAxq', 'y3jLyxrLigrLzG', 'rKvuq0HFqvDftq', 'nNWXFdm', 'AM9PBG', 'C3vJy2vZCW', 'lcbYzwnVBM5LyW', 'Aw5KzxHpzG', 'mtq0ma', 'u0X6t0y', 'y2HHCKf0', 'B25czwzVCMvszq', 'renuzhu', 'DNvHzfm', 'ywKUy29T', 'DKrXwwu', 'D2vIuMvXDwvZDa', 'y2HYB21Llwv4Da', 'zxjLrLu', 'DMLKzw8', 'zMLUza', 'ru5u', 'BgfZDefJDgL2zq', 'rurFve9FqKfdsW', 'ios/NEwTMowKSEI0PtO', 'BNq6', 'qMDzvvq', 'zNjVBq', 'DMLKzw8T', 'rMTbzwC', 'CMvZCg9UC2vizq', 'DhDvrNG', 'DgvZDa', 'yuTesfC', 'B25szw1VDMvK', 'r3jLr0K', 'EwfhvNm', 'rvvUD1i', 'AgfZ', 'B2jQzwn0', 'tNvTyMvY', '5Ps25yIW5RAi5OgVoG', 'u2fMyxjP', 'sM52sw4', 'nJKZody1zKLusg9t', 'AwXLza', 'r29ctum', 'BMfTzq', 'Btr2', 'qu5crKK', 'w3DZxsbUB3qGyW', 'qurFsvrftv9srq', 'DY5KB3v5Aw4UyW', 'kI5LlMT1ywLZAa', 'AgvSBg8', 'rMLYzwzVEa', '5Ps25yIW6kEg6Akr5OMt5BYa5RAi5OgVoG', 'uuTqwvi', 'zMLSDgvY', 'Bw92', 'zefYtwC', 'zw5ZAw9UoI8V', 'EMPlwLa', 'AgfZAa', 'Ag9ZDg5HBwu', 'DgfI', 's2nTzxK', 'zLvvAMK', 'rwrNzq', 'D3m6lY8XmJCUma', 'AgfZAhrHz19Uyq', 'mta4ma', 'C2HVCNrFAwq', 'DMLKzw8VBxa0', 'BMLJA25HBwu', 'zMLSzw5HBwu', 'BfzzveK', 'mJrvAfzHDxO', 'rNbesKi', 'AfHvvhK', 'yxbWzw5K', 'BM5Ly3rLzcWGDW', 'ww9kuxy', 'vMnPDwy', 'Dgv4Df9LEhrYyq', 'w3DZxsbYzwnLAq', 'u1rbuLq', 'B25dAgfUz2vK', 'Dg9mB3DLCKnHCW', 'ywrKtgLZDgvUzq', 'DxjSx2XPC3q', 'y29TCgXLDgu', 't3L0EuO', 'zMLUzeLUzgv4', 'C2T0B3aGB24GCa', 'DcbMywLSzwq6ia', 'q0XfqvjFuKvr', 'v2Lns24', 'wgHSwxi', 'nxW2Fdb8mW', 'revpx1vqrefurq', 'z2vUzxjPy19Tzq', 'tgPXvhC', 'DfDlzxO', 'sfD1wva', '5lIl6l295A6m5OIq', 'ms93zwiVyxDLBq', '5OM+5yIW5OQw6z+Z6kEg6Akrsuq', 'C29Tzq', 'DhjPBq', 'kI53B3jRyNvKza', 'zM9YrwfJAa', 'BM8Ty29YCW', 'B2DN', 'revpx0nmrufsxW', 'ENrwD2y', 'zg91EwLUlMnVBq', 'uvnnDwS', 'w3DZxsbJB25Uzq', 'DMLKzw9ZlW', 'C2nTrNC', 'tfHHEMO', 'yxDLBwvFAwq', 'B3j0', 'vuXjCgG', 'CgXHEv9HzgrY', 'BKHNuui', 'rv9ervrbsuXFuG', 'ioI/NUAoPEwKSEI0PtO', 'EwjSr2u', 'BgLZDa', 'qLrAy0y', 'C2HPzNq', 'y29VA2LLCW', 'BxjbAMC', 'DgLUzY4UlG', 'CMvWBgfJzq', 'B20VyxDLBwuVDG', '5lIl6l295PAh5lU25AsX6lsLoG', 'Cgf0Ag5HBwu', 'BtrZ', 'ru5e', 'C2vUza', 'CgfNzvrPDgXL', 'B25vCgrHDgvK', 'BfjdugC', 'D2LKDgG', 'C2uGAxmGzw1WDa', 'tgPbEeC', 'Dgv4Da', 'tevFve9FrevtsW', 'ChjVzMLSzq', 'DMLKzw8VD2vIBq', 'yuToDMu', 'y3rLzcb0BYbKzq', 'C2vJx3vPza', 'vxzXDMC', 'B25LCNjVCG', 'B25bBgfYBq', 'mZyW', 'n3W1Fdb8mNW0Fa', 'vKLeru9Ft1bftG', 'tw1fyK4', 'y3vYCMvUDa', 'twfiDg4', 'zfjPwwK', 'DhDTzgi', 'C3LUyY1Yzxf1zq', 'DwvZDcK', 'r09KwfK', 'svvQwuO', 'ios4QUwFN+wqJq', 'sKTsuLO', 'surft19srvnq', 'DgHLBG', '5lIl6l295AsX6lsL77Ym6k+35yI35PAW6Ag16z2I', 'DMLKzw9xAgL0zq', 'we5sEuG', 'iowiSoAwH+s7TUwKUtOG', 're9xtKXpqurFuW', 'zhPdq20', 'DxjS', 'B25jBNn0ywXSzq', 'yxzHDgfY', 'zM9YBwf0', 's2neCM0', 'y3jLyxrL', 'x3bVCNrjzhG', 'ndu5mZuZm3vgue9nsa', 'Devbwe0', 'AxnjBNrLz2vY', 'wNv0qMm', '6kEJ5P6q6kEg6Akr5l+H5OgV5AsX6lsL77Ym6k+3', 'Ahr0CdOVlYOVkG', 'ruXju1rFq0HbtG', 'uKvr', 'z1rtue4', 'u3rHCNrLza', 'vgzuq2i', 'Ahr0Chm6lY93DW', '5lIl6l29suq6ia', 'C3rVCMfNzq', '5PEG5Pwi55Qe5lIl6l29vvjmoIa', 'suXf', 'BK5RruG', 'zxH0zw5ZAw9U', 'zg91EwLUDM9KlG', 'yMLLzg4', 'CNvUDgLTzq', 'l+ABToAwSa', 'q09otKvdveLorW', 'Aw9JAvG', 'EvD3zeq', '5yI35PAW6Ag16z2I5BM26yEn6k+v', 'ioADOsWG', 'mJeYodq0m0vUyuTkvq', 'AxLRAuK', 'DMfSDwu', 'CgLUzW', 'BNrZ', 'Ahr0Ca', 'Bwf0Aw9UrMfPBa', 'As5JB20', 'CKDxAeW', 'vxbzre8', 'z2z2tKq', 'DgvKoIa', 'BwvZC2fNzq', 'AxnbCNjHEq', 'C2vHCMnOugfYyq', 'w3DZxsbHBgfYBq', 'zMn4zMO', 'CMf0q08', 'Dg9tDhjPBMC', 'zg93BMXVywrZ', 'y29VA2LLv2HPDa', 'q25hwfa', 'D3fRsKm', 'DgLTzq', 'DMLKzw8VB2DN', 'teve', 'Aw5JBhvKzxm', 'ote0mdr1z0r2ze4', 't0zjtevFu1LoqW', 'ueX6twy', 't1bftG', 'AMLUCML0zw1HAq', 'Aw5JBhvKzq', 'qwz1EwC', 'C3rHDgu', 'q2HYB21L', 'ug1ozgy', 'Dhj1zq', 'qNL6twW', 'zgf0yv9ZAxPL', 'weL3thC', 'revpx0Hjreu', 'r0vorvjjq19wsq', 'kI5KB3vIyw8UyW', 'C29YDa', 'uKvrvuvtvf9quG', 'C2LKx2D1yxjK', 'CgfYyw1Z', 'vKz5tem', 'Cg9W', 'z3rO', 'y29UDgvUDfr5Ca', 'qMfJA2DYB3vUza', 'DxjSx2zLDgnOpq', 'CxvLCNK', 'BwLU', '6kEJ5P6q6kEg6Akr5l+H5OgV5AsX6lsL77Ym5PYQ', 'CMfJzq', 'EK5vEMm', 'thbhD2C', 's0HrEMm', 'zgjrsMm', 'AxngAw5PDgu', 'C2f2zwrby2nVDq', 'r0ve', 'Ahr0Chm6lY8QlG', 'suXfra', 'ywLSihjLC3bVBG', 'qwLfDge', 'z2v0', 'zs9KzxrHAwWV', 'Dw5ZAgLMDa', 'vefuvvm', 'y29VA2LLq291BG', 're9xtKXpqurFsq', 'shHtC3u', 'zw5KC1DPDgG', 're9xtKXpqurFvG', 'CMvZB2X1DgLVBG', 'ywXHCM1Z', 'BM90zq', 'uunABvu', 'C3LUyW', 'BwvtDhjPBMC', 'teLtvf9srve', 'AxnezwzHDwX0', 'DMLKzw8VEc1Tna', 'y291BNqGy3jLyq', 'ugvuv2y', '5PAh5lU25lIl6l295lU75yQH5BEY5yIB5BU677Ym', 'surft19srve', 'CgfYC2u', 'z2v0qwXS', 'uuvTquS', 'zw5LCG', 'y2f0y2G', 't1bftL9uqui', 'r0vkrNi', 'x1zjrf9srve', 'EMrcA0O', 'CxvLC3q', 've9q', 'zxjYB3i', 'Bhj5AvC', 'DMLK', 'D3fRywW', 'yML0uMf0zq', 'wfPgA3m', 'BgfZDevYCM9Y', 'lMrVDxLPBI5JBW', 'rg91EwLUigrLDa', 'rgPir1q', '5BYa5AEl5lIl6l29', 'DMvYAwz5rNa', 'yxHKAhm', 'CgfYC2vjBMzVCG', 'n3WYFdr8ohWXFa', 'y29T', 'DxnLCKfNzw50', 'u1Djvenisu5hxW', 'z01jqLC', 'l2f3zw1Ll3yXlW', 'Aw5MBW', 'DgfICW', 'CxzSugG', 'AhDqwue', 'zxf1zxn0igzYBW', 'Bg9JywW', 'yxDLBwvjza', 'zMLdsMC', 'BgvUz3rO', 'DgfIswq', 'yxv0Ag9Y', 'zg93BMXVywq', 'DfHtELi', 'C2v0', 'DxjStgLZDa', 'Ahr0CdOVlZeYnW', 'twPTDNO', 'DwLK', 'C3bSAwnL', 'A1fmCe4', 'BM93', 'zgf0yq', 'AKnRBhq', 'DMLKzw8VCxvPyW', 'CgfYyw1Fy2fJAa', 'C3rHCNrZv2L0Aa', 'zg9TywLU', 'iow3SUwgMEwfPEE8K+wTMdOG6lsM5y+3', 'qwnJB3vUDeLK', 'z2nwAvi', 'vfPRyLC', 'vevnx1jfuq', 'vLnOq3K', 'CMvTB3zLtgLZDa', 'rgvMyxvSDcbHyW', 'qwTIA3G', 'rurFve9Fq09ova', 'qKfly1G', 'Bwf0y2G', 'vvnfuL9dqu5drq', 'zwXPC3q', 'D2vIBq', 'mJa3mdaZnKfxthb4zW', 'CNfjqNm', 'C2vUze1LC3nHzW', 'B25nzxnZywDL', 'BwfW', 'B2D2', 'BMD0Aa', 'B1LUs3G', 'CLfysvi', 'zg91EwLUlxzPza', 'sgTMtvK', 'ug9JBgC', 'yYaOD2LSBcbYzq', 'zxH0zw5ZAw9UoG', 'Dw5PCxvPzNK', 'y29UDgvUDeXLBG'];
  _0x1c4a = function () {
    return _0x351c0c;
  };
  return _0x1c4a();
}
function _0x44e0(_0x3fd700, _0x5f7c7d) {
  _0x3fd700 = _0x3fd700 - (0x1496 + 0x1b2e * -0x1 + 0x3 * 0x254);
  const _0x332d96 = _0x1c4a();
  let _0x3887b2 = _0x332d96[_0x3fd700];
  if (_0x44e0['bsgEqr'] === undefined) {
    var _0x57ee67 = function (_0x545a96) {
      const _0x175175 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
      let _0x1aa7db = '', _0x25e74a = '';
      for (let _0x4395c3 = 0x99 * -0x35 + -0x21d8 + 0x3 * 0x15d7, _0x35cb79, _0x859703, _0x2b8faa = -0xb * 0x30a + -0x1fd * -0xb + 0xb8f * 0x1; _0x859703 = _0x545a96['charAt'](_0x2b8faa++); ~_0x859703 && (_0x35cb79 = _0x4395c3 % (-0xb1 * -0x2 + -0x112d * -0x1 + 0x1 * -0x128b) ? _0x35cb79 * (0x1fe5 + -0xd2b + -0x127a) + _0x859703 : _0x859703, _0x4395c3++ % (-0x1 * -0x231b + -0x7e * -0x2a + -0x37c3)) ? _0x1aa7db += String['fromCharCode'](0x2 * -0x3d9 + -0xf6 + 0x9a7 * 0x1 & _0x35cb79 >> (-(0x1ef + 0x1cd * 0x13 + -0x24 * 0x101) * _0x4395c3 & 0x2 * 0xe6b + 0x1931 + -0x3601)) : -0x362 * -0x1 + -0x1 * -0x1315 + -0x1b * 0xd5) {
        _0x859703 = _0x175175['indexOf'](_0x859703);
      }
      for (let _0x52b964 = 0x242a + 0x1 * -0x1fb1 + -0xe5 * 0x5, _0x1c818d = _0x1aa7db['length']; _0x52b964 < _0x1c818d; _0x52b964++) {
        _0x25e74a += '%' + ('00' + _0x1aa7db['charCodeAt'](_0x52b964)['toString'](0x224e + -0x1850 + 0x2 * -0x4f7))['slice'](-(8277 + -0x2053));
      }
      return decodeURIComponent(_0x25e74a);
    };
    (_0x44e0['jGiGll'] = _0x57ee67, _0x44e0['LhICSB'] = {}, _0x44e0['bsgEqr'] = !![]);
  }
  const _0x54cecf = _0x332d96[-0x115 * -0x23 + 0x289 * -0xd + 0x11 * -0x4a], _0x1d73d2 = _0x3fd700 + _0x54cecf, _0xbab482 = _0x44e0['LhICSB'][_0x1d73d2];
  return (!_0xbab482 ? (_0x3887b2 = _0x44e0['jGiGll'](_0x3887b2), _0x44e0['LhICSB'][_0x1d73d2] = _0x3887b2) : _0x3887b2 = _0xbab482, _0x3887b2);
}
initializeDouyinVideoDownloader();
initializeGenericVideoDownloader();
chrome['runtime']["onMessage"]["addListener"]((_0x402093, _0xb18fcf, _0x2442ca) => {
  const _0x173838 = _0x99078e, _0x1078ff = {
    'QEmAK': "标签页创建成功:",
    'lVivM': '标签页\x20',
    'QKPYR': function (_0x30fc80, _0x3fbe1c) {
      return _0x30fc80 + _0x3fbe1c;
    },
    'tXSzR': "发送消息到标签页 ",
    'KHQzc': " 失败:",
    'biedn': function (_0x470e01, _0x2d71e2) {
      return _0x470e01(_0x2d71e2);
    },
    'UpYDO': '下载文件失败:',
    'wqkJC': function (_0x1e4374, _0x5feaac) {
      return _0x1e4374 !== _0x5feaac;
    },
    'nHgQB': function (_0x11788e, _0xe78a9c, _0x169292, _0x53dd3e, _0x16425e) {
      return _0x11788e(_0xe78a9c, _0x169292, _0x53dd3e, _0x16425e);
    },
    'MmEbN': function (_0x5afc31, _0x2671fa) {
      return _0x5afc31(_0x2671fa);
    },
    'UOyve': function (_0x4b1cd7, _0x13d416) {
      return _0x4b1cd7(_0x13d416);
    },
    'SLzOF': function (_0x3b8ecf, _0x3735df) {
      return _0x3b8ecf === _0x3735df;
    },
    'BgYUT': function (_0xcb224c) {
      return _0xcb224c();
    },
    'LznQJ': function (_0x21a485, _0x479351) {
      return _0x21a485 + _0x479351;
    },
    'wqkal': '标签页操作失败:',
    'iyAkT': "VIDEO_OPENED_TO_BACK",
    'nNkEH': "Background收到视频打开消息:",
    'XIwLw': function (_0x2da1b3, _0x4b2a98) {
      return _0x2da1b3 === _0x4b2a98;
    },
    'RrGuP': "DOWNLOAD_FILE",
    'kYFYG': function (_0x4b56d7, _0x2fbb30, _0x27be40, _0x1d6d77) {
      return _0x4b56d7(_0x2fbb30, _0x27be40, _0x1d6d77);
    },
    'IUjYJ': function (_0x3e4da9, _0xdb2c93, _0x41de05) {
      return _0x3e4da9(_0xdb2c93, _0x41de05);
    }
  };
  if (_0x402093["type"] === "OPEN_TAB") {
    const _0x104e83 = _0x1078ff['QKPYR'](_0x1078ff["LznQJ"](_0x402093["url"], _0x402093['url']["includes"]('?') ? '&' : '?'), "url_fetch=true");
    try {
      const _0x560160 = {
        'url': _0x104e83,
        'active': !(0x256c * 0x1 + 0xf3b + -0x34a6)
      };
      chrome['tabs']["create"](_0x560160, _0x17ce10 => {
        const _0x54e07d = _0x173838;
        chrome['runtime']['lastError'] ? console["error"]('创建标签页失败:', chrome["runtime"]["lastError"]) : console['log'](_0x1078ff["QEmAK"], _0x17ce10['id']);
      });
    } catch (_0x2b8f52) {
      console["error"](_0x1078ff["wqkal"], _0x2b8f52);
    }
  } else _0x402093["type"] === _0x1078ff["iyAkT"] && (console['log'](_0x1078ff["nNkEH"], _0x402093['url']), chrome["tabs"]['query']({}, _0x5cfbc0 => {
    const _0x2af4e4 = _0x173838, _0x3b2f72 = {
      'rqIBs': function (_0x22f166, _0x3033a5) {
        return _0x22f166 + _0x3033a5;
      },
      'DWVsd': _0x1078ff['lVivM'],
      'iociX': function (_0x2812f4, _0x14afc0) {
        const _0x31360b = _0x44e0;
        return _0x1078ff["QKPYR"](_0x2812f4, _0x14afc0);
      },
      'wdzyJ': _0x1078ff["tXSzR"],
      'twmdb': _0x1078ff["KHQzc"]
    };
    _0x5cfbc0["forEach"](_0x1af99b => {
      const _0x5ef2ae = _0x2af4e4;
      try {
        const _0x5b8c0c = {
          'type': "VIDEO_OPENED_TO_CONTENT",
          'url': _0x402093["url"]
        };
        chrome["tabs"]["sendMessage"](_0x1af99b['id'], _0x5b8c0c, _0x42b1ca => {
          const _0x1da7a7 = _0x5ef2ae;
          chrome['runtime']['lastError'] && console['log'](_0x3b2f72["rqIBs"](_0x3b2f72['DWVsd'] + _0x1af99b['id'], " 连接失败:"), chrome["runtime"]["lastError"]["message"]);
        });
      } catch (_0x4daf48) {
        console["log"](_0x3b2f72["iociX"](_0x3b2f72['wdzyJ'] + _0x1af99b['id'], _0x3b2f72["twmdb"]), _0x4daf48['message']);
      }
    });
  }));

  switch (_0x402093["type"]) {
    case _0x1078ff["RrGuP"]:
      _0x1078ff['kYFYG'](downloadFile, _0x402093["url"], _0x402093["filename"], _0x402093['folderName'])['then'](_0x3c14a4 => {
        const _0x5e1a27 = {
          'success': !(0x21e5 + -0xc26 + 0x1 * -0x15bf),
          'downloadId': _0x3c14a4
        };
        _0x2442ca(_0x5e1a27);
      })["catch"](_0x33ad8e => {
        const _0x2258be = _0x173838;
        (console["error"](_0x1078ff["UpYDO"], _0x33ad8e), _0x2442ca({
          'success': !(0x11f4 + -0x1077 + 0x2 * -0xbe),
          'error': _0x33ad8e["message"]
        }));
      });
      return !(0x13 * -0x7a + 0x4e4 * 0x4 + -0xa82);
    case DOUYIN_MESSAGE_TYPES["DOWNLOAD_VIDEO_REQ"]:
      downloadDouyinAwemeVideo(_0x402093, _0xb18fcf)['then'](_0xd53268 => {
        const _0x15e561 = _0x173838;
        _0x1078ff["biedn"](_0x2442ca, {
          'type': DOUYIN_MESSAGE_TYPES["DOWNLOAD_VIDEO_RESP"],
          'success': _0x1078ff["wqkJC"](_0xd53268["success"], ![]),
          'downloadId': _0xd53268["downloadId"],
          'filename': _0xd53268["filename"],
          'url': _0xd53268["url"]
        });
      })["catch"](_0x587e70 => {
        const _0x274c4c = _0x173838, _0x2e4a58 = _0xb18fcf && _0xb18fcf['tab'] ? _0xb18fcf["tab"]['id'] : null;
        (_0x1078ff["nHgQB"](sendDouyinDownloadStatus, _0x2e4a58, DOUYIN_SNACKBAR_TEXT["downloadFailed"], "error", -0x300 + -0x1034 + 0x1b04), _0x2442ca({
          'type': DOUYIN_MESSAGE_TYPES["DOWNLOAD_VIDEO_RESP"],
          'success': ![],
          'error': _0x587e70["message"]
        }));
      });
      return !(-0x144 + 0xe3 * -0xe + -0x1 * -0xdae);
    case DOUYIN_MESSAGE_TYPES["ERROR_FIND_VID_REQ"]:
      _0x1078ff["UOyve"](_0x2442ca, {
        'success': !![]
      });
      return !(-0x1ebc + 0x321 + 0x1b9c);
    case GENERIC_VIDEO_MESSAGE_TYPES["LIST_REQ"]:
      const _0x4aa586 = getMessageTabId(_0x402093, _0xb18fcf);
      _0x1078ff["MmEbN"](isSupportedCommerceTab, _0x4aa586)['then'](_0x1315f7 => {
        const _0x13c611 = _0x173838;
        if (!_0x1315f7) {
          _0x1078ff["biedn"](_0x2442ca, {
            'success': !![],
            'items': []
          });
          return;
        }
        return getGenericMediaList(_0x4aa586);
      })["then"](_0x946996 => {
        const _0x53dd48 = _0x173838;
        _0x946996 && _0x1078ff["MmEbN"](_0x2442ca, {
          'success': !![],
          'items': _0x946996
        });
      })["catch"](_0x14aa2d => {
        const _0x3faa1e = _0x173838;
        _0x1078ff["UOyve"](_0x2442ca, {
          'success': ![],
          'error': _0x14aa2d["message"]
        });
      });
      return !(-0x34a + 0x2284 + -0xe * 0x23b);
    case GENERIC_VIDEO_MESSAGE_TYPES["CLEAR_REQ"]:
      clearGenericMedia(_0x402093.tabId).then(() => _0x2442ca({success: true}));
      return true;
    case GENERIC_VIDEO_MESSAGE_TYPES["DOWNLOAD_ITEM_REQ"]:
      _0x1078ff["IUjYJ"](downloadGenericMediaItem, _0x402093, _0xb18fcf)["then"](_0x4ac340 => {
        _0x2442ca(_0x4ac340);
      })["catch"](_0x201169 => {
        const _0x4d3646 = _0x173838;
        _0x2442ca({
          'success': ![],
          'error': _0x201169["message"]
        });
      });
      return !(0xa4 + -0x9b * 0x11 + 0x9a7);
  }
});
