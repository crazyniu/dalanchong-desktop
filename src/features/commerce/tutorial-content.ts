/**
 * AI module map
 * Purpose: share concise Chinese instructions between onboarding and the tutorial page.
 * Entry: guideSteps is read by onboarding.tsx and tutorial.tsx in the displayed order.
 * Ownership: these static steps describe existing actions; they never navigate, log in,
 * collect, or send invitations. Keep account boundaries and invitation rules aligned
 * with invites.tsx, runner.mjs, and workbench.tsx when those flows change.
 */

export const guideSteps = [
  {
    id: 'accounts',
    emoji: '👤',
    title: '添加账号并登录',
    location: '侧栏 → 抖音达人邀约 / 快手达人邀约',
    steps: [
      '选择平台，点击“添加账号”或账号栏的“＋”，填写账号名称。',
      '在打开的平台网页完成登录，账号标签显示绿色圆点即为已登录。',
      '多个账号用顶部标签切换，采集和邀约都使用当前账号。',
    ],
  },
  {
    id: 'collect',
    emoji: '🔎',
    title: '找到达人并采集',
    location: '平台网页 → 底部工具栏',
    steps: [
      '进入支持采集的达人页面，先在网页设置搜索和筛选条件。',
      '在底部选择“采集达人”，点击“开始采集”。',
      '在右下角查看采集记录；采集结束后，点击“邀约达人”打开列表。',
    ],
  },
  {
    id: 'queue',
    emoji: '📋',
    title: '选择邀约范围',
    location: '采集列表 → 批量邀约 / 邀约所选',
    steps: [
      '用搜索和筛选缩小范围；需要指定达人时，可跨页勾选。',
      '未勾选时点“批量邀约”，有勾选时点“邀约所选”。',
      '仅当前账号下没有邀约记录的达人会进入本次队列。',
    ],
  },
  {
    id: 'configure',
    emoji: '✍️',
    title: '填写邀约配置',
    location: '邀约达人弹框',
    steps: [
      '填写商品 ID、邀约话术和联系方式；抖音最多 5 个商品、150 字话术。',
      '设置邀约间隔：快手最低 2000 毫秒，抖音最低 5000 毫秒。最大邀约数留空表示不限制。',
      '确认当前账号和本次人数后，点击“开始邀约”。',
    ],
  },
  {
    id: 'results',
    emoji: '📊',
    title: '查看进度和结果',
    location: '右下角进度卡 / 底部“邀约记录”',
    steps: [
      '在右下角查看处理进度，需要中止时点击对应账号的“停止”。',
      '打开“邀约记录”查看结果和接口返回；异常原因可在“错误日志”查看。',
      '遇到“待核实”，先核对平台记录，再选择“确认已邀约”或“确认未邀约”。',
    ],
  },
  {
    id: 'shops',
    emoji: '🏪',
    title: '使用多店铺管理',
    location: '侧栏 → 多店铺管理',
    steps: [
      '点击“新建店铺”，填写名称并创建，在打开的 Chrome 窗口登录店铺。',
      '每个店铺独立保存登录和浏览数据，与达人邀约页面的账号分别管理。',
      '需要视频工具时，点击 Chrome 右上角的插件图标或“视频下载”书签。',
    ],
  },
] as const
