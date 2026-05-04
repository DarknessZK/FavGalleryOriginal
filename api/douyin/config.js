// ==========================================
// FavGallery - 抖音平台配置
// 职责：提供抖音平台特定的配置信息
// ==========================================

import { getPlatformEndpoints } from '../../config/constants.js';

/**
 * 抖音平台配置对象
 */
export const DOUYIN_CONFIG = {
    // ==========================================
    // API 端点配置
    // ==========================================

    /**
     * 抖音 API 端点
     * 从全局配置中获取
     */
    API_ENDPOINTS: getPlatformEndpoints('douyin'),

    // ==========================================
    // 设备参数配置
    // ==========================================

    /**
     * 固定设备参数模板
     * 这些参数在大多数 API 请求中都会用到
     */
    DEVICE_PARAMS_TEMPLATE: {
        aid: '6383',
        device_platform: 'webapp',
        channel: 'channel_pc_web',
        update_version_code: '170400',
        pc_client_type: '1',
        version_code: '170400',
        version_name: '17.4.0'
    },

    /**
     * 作者作品列表的额外设备参数
     * 作者作品 API 需要更多浏览器环境参数
     */
    AUTHOR_WORK_DEVICE_PARAMS: {
        app_name: 'douyin_web',
        version_code: '190500',
        version_name: '19.5.0',
        device_platform: 'web',
        os_version: '',
        pc_client_type: '1',
        cookie_enabled: 'true',
        screen_width: '1920',
        screen_height: '1080',
        browser_language: 'zh-CN',
        browser_platform: 'Win32',
        browser_name: 'Chrome',
        browser_version: '120.0.0.0'
    },

    // ==========================================
    // 请求配置
    // ==========================================

    /**
     * 默认请求头
     */
    DEFAULT_HEADERS: {
        'Content-Type': 'application/json',
        'Referer': 'https://www.douyin.com/'
    },

    /**
     * POST 请求的 Content-Type
     * 收藏列表等 API 需要使用 form-urlencoded
     */
    FORM_HEADERS: {
        'Content-Type': 'application/x-www-form-urlencoded'
    },

    // ==========================================
    // 重试和延迟配置
    // ==========================================

    /**
     * 重试配置
     */
    RETRY_CONFIG: {
        maxRetries: 3,              // 最大重试次数
        baseDelay: 2000,            // 基础延迟（毫秒）
        backoffMultiplier: 2        // 退避倍数（指数退避）
    },

    /**
     * 请求间隔配置
     */
    REQUEST_DELAY: {
        normal: 1000,               // 正常请求间隔（毫秒）
        afterError: 2000,           // 错误后的延迟（毫秒）
        betweenBatches: 1000        // 批次之间的延迟（毫秒）
    },

    // ==========================================
    // 数据提取配置
    // ==========================================

    /**
     * 用户信息数据源优先级
     * 按顺序尝试从不同位置获取用户信息
     */
    USER_INFO_SOURCES: [
        '__INITIAL_STATE__.user.info',
        '__INITIAL_STATE__.user',
        'RENDER_DATA.app.user.info',
        'RENDER_DATA[1].user.info',
        'RENDER_DATA.app.user',
        'RENDER_DATA[1].user',
        'SSR_RENDER_DATA_DOC.app.user.info',
        'SSR_RENDER_DATA_DOC[1].user.info',
        'SSR_RENDER_DATA_DOC.app.user'
    ],

    /**
     * WebID 数据源优先级
     */
    WEBID_SOURCES: [
        'ssrData.webId',
        'SSR_RENDER_DATA.app.odin.user_unique_id',
        'SSR_RENDER_DATA[1].odin.user_unique_id',
        'SSR_RENDER_DATA.C_0.odin.user_unique_id',
        'RENDER_DATA.app.odin.user_unique_id',
        'RENDER_DATA[1].odin.user_unique_id'
    ],

    /**
     * 主页 URL 模式
     * 用于判断当前页面是否为主页
     */
    HOME_PAGE_PATTERNS: [
        '/jingxuan',
        '/recommend'
    ]
};

export default DOUYIN_CONFIG;
