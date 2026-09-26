// ==========================================
// FavGallery - 全局常量配置
// 职责：仅存储纯配置数据，不包含任何业务逻辑
// ==========================================

export const CONFIG = {
    // ==========================================
    // 平台配置
    // ==========================================
    
    /**
     * 当前激活的平台（默认值）
     * 可通过 platformAPI.switchPlatform() 运行时切换
     * 可选值：'douyin', 'xiaohongshu' 等
     */
    ACTIVE_PLATFORM: 'douyin',
    
    /**
     * 支持的平台列表
     * 添加新平台时在此注册
     */
    SUPPORTED_PLATFORMS: ['douyin'],
    
    /**
     * 平台信息显示配置
     * 用于 UI 展示平台相关信息
     */
    PLATFORM_INFO: {
        douyin: {
            name: '抖音',
            description: '帮助用户管理和备份个人抖音收藏内容'
        }
        // xiaohongshu: {
        //     name: '小红书',
        //     description: '帮助用户管理和备份个人小红书收藏内容'
        // },
        // bilibili: {
        //     name: 'B站',
        //     description: '帮助用户管理和备份个人B站收藏内容'
        // }
    },
    
    // ==========================================
    // API 端点配置（按平台分类）
    // ==========================================
    
    API_ENDPOINTS: {
        /**
         * 抖音平台 API 端点
         * 参考：抖音网页端实际使用的 API
         */
        douyin: {
            // 用户相关
            USER_PROFILE: 'https://www.douyin.com/aweme/v1/web/user/profile/other/',
            
            // 列表相关
            FOLLOWING_LIST: 'https://www.douyin.com/aweme/v1/web/user/following/list/',
            LIKED_WORKS: 'https://www.douyin.com/aweme/v1/web/aweme/favorite/',
            BOOKMARKED_WORKS: 'https://www.douyin.com/aweme/v1/web/aweme/listcollection/',
            
            // 视频相关
            VIDEO_DETAIL: 'https://www.douyin.com/aweme/v1/web/aweme/detail/',
            AUTHOR_WORKS: 'https://www.douyin.com/aweme/v1/web/aweme/post/',
            
            // 收藏夹相关
            COLLECTS_LIST: 'https://www-hj.douyin.com/aweme/v1/web/collects/list/',
            COLLECTS_WORKS: 'https://www-hj.douyin.com/aweme/v1/web/collects/video/list/'
        }
        
        // 未来扩展示例：
        // bilibili: {
        //     USER_PROFILE: '...',
        //     FOLLOWING_LIST: '...',
        //     FOLLOWING_GROUPS: '...',  // ✅ B站关注分组
        //     LIKED_WORKS: '...',
        //     BOOKMARKED_WORKS: '...'
        // }
    },
    
    // ==========================================
    // 文件系统配置
    // ==========================================
    
    FILE_SYSTEM: {
        /** 应用数据根目录（隐藏文件夹） */
        APP_DATA_DIR: '.FavGallery',
        
        /** 元数据存储目录（按平台分类） */
        METADATA_DIR: '.FavGallery/metadata',
        
        /** JS/CSS 资源目录 */
        JS_DIR: '.FavGallery/resources/js',
        
        /** ✅ 日志存储目录（按平台分类） */
        LOG_DIR: '.FavGallery/logs',
        
        /** ✅ 用户配置文件路径（全局，跨平台共享） */
        CONFIG_FILE: '.FavGallery/config.json',
        
        /** ✅ 离线浏览页数据子目录（位于 metadata/{platform}/ 下） */
        OFFLINE_DIR: 'offline',
        
        /** ✅ 离线浏览页跨平台清单文件（位于 metadata/ 下，供页面判断渲染哪些平台） */
        OFFLINE_INDEX_FILE: '.FavGallery/metadata/offline-index.js',
        
        /** ✅ 离线浏览页静态壳资源目录（HTML 引用的 css/js） */
        OFFLINE_VIEWER_DIR: '.FavGallery/resources/offline-viewer',
        
        /** ✅ 离线浏览页入口 HTML 文件名（生成到用户根目录，唯一露给用户的入口文件） */
        OFFLINE_ENTRY_HTML: 'FavGallery.html',
        
        /** 元数据文件名称映射 */
        METADATA_FILES: {
            AUTHORS: 'authors',
            FOLLOWING_STATUS: 'following_status',
            LIKED_WORKS: 'liked_works',  // ✅ 改为 liked_works
            BOOKMARKED_WORKS: 'bookmarked_works'  // ✅ 改为 bookmarked_works
        }
    },
    
    // ==========================================
    // UI 配置
    // ==========================================
    
    UI_CONFIG: {
        /** 侧边栏配置 */
        SIDEBAR: {
            /** 侧边栏宽度（像素） */
            WIDTH: 420,
            
            /** 收起状态宽度（像素） */
            COLLAPSED_WIDTH: 0,
            
            /** 切换动画时长（秒） */
            TRANSITION_DURATION: 0.3,
            
            /** z-index 层级 */
            Z_INDEX: 999999,
            
            /** 切换按钮 z-index */
            TOGGLE_BTN_Z_INDEX: 1000000,
            
            /** iframe 加载完成后发送用户信息的延迟时间（毫秒） */
            IFRAME_LOAD_DELAY: 500,
            
            /** 容器样式 */
            CONTAINER_STYLES: {
                position: 'fixed',
                top: '0',
                left: '0',
                height: '100vh'
            },
            
            /** iframe 样式 */
            IFRAME_STYLES: {
                height: '100vh',
                border: 'none',
                overflow: 'hidden',
                background: 'transparent'
            },
            
            /** 切换按钮样式 */
            TOGGLE_BUTTON_STYLES: {
                position: 'fixed',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '24px',
                height: '48px',
                background: '#fff',
                border: '1px solid #e8e8e8',
                borderLeft: 'none',
                borderRadius: '0 4px 4px 0',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#666',
                boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        }
    },
    
    // ==========================================
    // 用户配置文件（.FavGallery/config.json）
    // ==========================================
    
    /**
     * ✅ 用户配置文件元信息
     * 说明：配置文件在选择文件夹时生成/读取，默认值在运行时
     *      由 FETCH_CONFIG.LIST_CONFIGS 派生（单一数据源，避免重复硬编码）。
     *      未来 UI 配置面板将读写此文件（含 backup 配置项）。
     */
    USER_CONFIG: {
        /** 配置文件结构版本号，结构变更时递增，用于迁移兼容 */
        version: 1
    },
    
    // ==========================================
    // 数据获取配置
    // ==========================================
    
    FETCH_CONFIG: {
        /** 默认最大获取数量 */
        DEFAULT_MAX_COUNT: 50,
        
        /** 正常模式最大获取数量 */
        NORMAL_MAX_COUNT: 60,
        
        /** 批量下载模式最大获取数量 */
        BATCH_MAX_COUNT: 200,
        
        /** ✅ 列表基础配置 - 纯数据配置（不含方法） */
        LIST_CONFIGS: {
            liked: {
                maxCount: 120,
                folderRequired: true,
                skipIncrementalCheck: false,
                saveKey: 'works',  // ✅ 保存时的字段名
                resultKey: 'works',  // ✅ API返回的字段名
                idField: 'workId',  // ✅ 主键字段名
                relations: {
                    groupType: 'liked_group',
                    groupId: 'liked',
                    // ✅ 关系构建配置
                    sourceType: 'work',
                    sourceField: 'workId',
                    targetType: 'liked_group',
                    targetId: 'liked'
                },
                messages: {
                    loaded: 'LIKED_WORKS_LOADED',
                    progress: 'LIKED_WORKS_PROGRESS',
                    error: 'LIKED_WORKS_ERROR',
                    clear: 'CLEAR_LIKED_LIST',
                    start: 'LOAD_DATA_START'
                }
            },
            bookmarked: {
                maxCount: 60,
                folderRequired: true,
                skipIncrementalCheck: false,
                saveKey: 'works',  // ✅ 保存时的字段名
                resultKey: 'works',  // ✅ API返回的字段名
                idField: 'workId',  // ✅ 主键字段名
                relations: {
                    groupType: 'collect',
                    groupId: null,  // 动态设置
                    // ✅ 关系构建配置
                    sourceType: 'work',
                    sourceField: 'workId',
                    targetType: 'collect',
                    targetField: 'collectId'  // 动态获取
                },
                messages: {
                    loaded: 'COLLECT_WORKS_LOADED',
                    progress: 'COLLECT_WORKS_PROGRESS',
                    error: 'COLLECT_WORKS_ERROR',
                    clear: 'CLEAR_BOOKMARKED_LIST',
                    start: 'LOAD_DATA_START'
                }
            },
            following: {
                maxCount: 60,
                folderRequired: true,
                skipIncrementalCheck: false,  // 关注列表始终调用API检测软删除
                saveKey: 'authors',  // ✅ 保存时的字段名
                resultKey: 'authors',  // ✅ API返回的字段名
                idField: 'uid',  // ✅ 主键字段名
                groupTableName: 'author_groups',  // ✅ 分组表名
                countField: 'authorCount',  // ✅ 计数字段名
                relations: {
                    groupType: 'author_group',
                    groupId: null,  // ✅ 动态生成：${platform}_following
                    // ✅ 关系构建配置
                    sourceType: 'author',
                    sourceField: 'uid',
                    targetType: 'author_group',
                    targetId: null  // ✅ 动态生成：${platform}_following
                },
                // ✅ 抖音平台需要创建默认作者分组
                needDefaultGroup: true,
                defaultGroupConfig: {
                    groupName: '默认',
                    description: '',
                    sortOrder: 0
                },
                messages: {
                    loaded: 'FOLLOWING_AUTHORS_LOADED',
                    progress: 'FOLLOWING_AUTHORS_PROGRESS',
                    error: 'FOLLOWING_AUTHORS_ERROR',
                    clear: 'CLEAR_FOLLOWING_LIST',
                    start: 'LOAD_DATA_START'
                }
            },
            collects: {
                maxCount: 100,
                folderRequired: true,
                skipIncrementalCheck: true,  // 收藏夹列表始终调用API检测软删除
                saveKey: 'collects',  // ✅ 保存时的字段名
                resultKey: 'collects',  // ✅ API返回的字段名
                idField: 'collectId',  // ✅ 主键字段名
                groupTableName: 'collect_groups',  // ✅ 分组表名
                countField: 'collectCount',  // ✅ 计数字段名
                // ✅ 抖音平台需要创建默认收藏夹分组
                needDefaultGroup: true,
                defaultGroupConfig: {
                    groupName: '默认',
                    description: '',
                    sortOrder: 0
                },
                relations: {
                    groupType: 'collect_group',
                    groupId: null,  // ✅ 动态生成：${platform}_collects
                    // ✅ 关系构建配置
                    sourceType: 'collect',
                    sourceField: 'collectId',
                    targetType: 'collect_group',
                    targetId: null  // ✅ 动态生成：${platform}_collects
                },
                messages: {
                    loaded: 'COLLECTS_LIST_LOADED',
                    progress: 'COLLECTS_LIST_PROGRESS',
                    error: 'COLLECTS_LIST_ERROR',
                    clear: null,
                    start: 'LOAD_DATA_START'
                }
            }
        },
        
        /** ✅ API 请求间隔配置（防封号） */
        REQUEST_DELAY: {
            /** 最小延迟（毫秒） */
            min: 1000,
            /** 最大延迟（毫秒） */
            max: 2000
        }
    },
    
    // ==========================================
    // 备份配置
    // ==========================================
    
    BACKUP_CONFIG: {
        /** 定时备份间隔（毫秒）- 默认 10 分钟 */
        interval: 10 * 60 * 1000,
        
        /** 是否启用定时备份 */
        enabled: false,
        
        /** 列表加载备份配置 */
        listBackup: {
            /** 每 N 批后备份一次 - 默认 5 批 */
            batchInterval: 5,
            
            /** 是否启用阶段性备份 */
            enabled: true
        },
        
        /** 下载备份配置 */
        downloadBackup: {
            /** 时间阈值（毫秒）- 默认 1 分钟 */
            timeThreshold: 60 * 1000,
            
            /** 数量阈值（条数）- 默认 10 条 */
            countThreshold: 10,
            
            /** 是否启用混合策略 */
            enabled: true,
            
            /** ✅ 新增：立即备份到本地文件配置 */
            immediateBackup: {
                /** 是否启用立即备份 */
                enabled: true,
                
                /** 延迟时间（毫秒）- 避免频繁 I/O，默认 5 秒 */
                delay: 5000
            }
        }
    },
    
    // ==========================================
    // 数据库配置
    // ==========================================
    
    DB_CONFIG: {
        /** 数据库名称 */
        name: 'FavGallery',
        
        /** 数据库版本 */
        version: 1,
        
        /**
         * 对象存储配置
         * key: 存储名称, value: 主键字段
         */
        stores: {
            // === 核心数据 ===
            works: 'workId',                    // ✅ 作品元数据
            completed_works: 'workId',          // ✅ 已完成作品ID
            
            // === 通用关系表 ===
            relations: 'id',                     // 通用关系表
            
            // === 分组列表（只存储元数据）===
            liked_group: 'groupId',             // ✅ 点赞分组元数据
            authors: 'uid',                      // 作者列表元数据
            collects: 'collectId',              // ✅ 收藏夹列表元数据
            author_groups: 'groupId',           // ✅ 作者分组元数据（未来扩展）
            collect_groups: 'groupId',          // ✅ 收藏夹分组元数据
            
            // === 系统配置 ===
            settings: 'key'                      // 系统设置
        },
        
        /**
         * 索引配置
         * 定义每个 store 需要创建的索引
         */
        indexes: {
            // works 表的索引
            works: [
                { name: 'authorId', keyPath: 'author.uid', unique: false },
                { name: 'createTime', keyPath: 'createTime', unique: false }
            ],
            
            // completed_works 表的索引
            completed_works: [
                { name: 'downloadTime', keyPath: 'downloadTime', unique: false }
            ],
            
            // relations 表的索引（核心）
            relations: [
                { name: 'sourceType', keyPath: 'sourceType', unique: false },  // ✅ 新增：按类型查询
                { name: 'source', keyPath: ['sourceType', 'sourceId'], unique: false },
                { name: 'target', keyPath: ['targetType', 'targetId'], unique: false },
                { name: 'sourceToTarget', keyPath: ['sourceType', 'sourceId', 'targetType', 'targetId'], unique: true }
            ]
        }
    },

    // ==========================================
    // 下载配置
    // ==========================================
    
    DOWNLOAD_CONFIG: {
        /**
         * 批量下载配置
         */
        batch: {
            /** 作品间最小延迟（毫秒）- 防封号 */
            minDelay: 2000,
            
            /** 作品间最大延迟（毫秒）- 防封号 */
            maxDelay: 5000,
            
            /** 单个作品最大重试次数 */
            maxRetries: 2,
            
            /** 重试延迟基数（毫秒）- 指数退避：retryDelayBase * retryCount */
            retryDelayBase: 6000,
            
            /** 批次任务超时时间（毫秒）- 0 表示不超时 */
            timeout: 0
        },
        
        /**
         * 单个作品下载配置
         */
        single: {
            /** 下载超时时间（毫秒）- 默认 3分钟，Content Script 中可覆盖为 5分钟 */
            timeout: 3 * 60 * 1000,
            
            /** Content Script 中的下载超时时间（毫秒）- 5分钟 */
            contentScriptTimeout: 5 * 60 * 1000,
            
            /** 是否启用断点续传（检查文件是否存在） */
            enableResume: true,
            
            /** 是否跳过已存在的文件 */
            skipExisting: true,
            
            /** ✅ 文件大小阈值：超过此值使用 Blob，否则使用 ArrayBuffer（字节） */
            blobThreshold: 20 * 1024 * 1024  // 20MB
        },
        
        /**
         * 分组下载配置（作者/收藏夹级别）
         */
        group: {
            /** 作者/收藏夹之间最小延迟（毫秒）- 防封号 */
            minDelay: 3000,
            
            /** 作者/收藏夹之间最大延迟（毫秒）- 防封号 */
            maxDelay: 5000,
            
            /** 是否自动跳过已完成的任务 */
            autoSkipCompleted: true,
            
            /** 是否显示详细进度日志 */
            verboseLog: false
        },
        
        /**
         * 文件系统配置
         */
        fileSystem: {
            /** 默认保存根目录名称 */
            defaultRootDir: 'FavGallery_Downloads',
            
            /** ✅ 平台文件夹名称映射（可配置，支持用户自定义） */
            platformFolderMap: {
                'douyin': '抖音',
                'kuaishou': '快手',
                'bilibili': 'B站',
                'tiktok': 'TikTok'
            },
            
            /** ✅ 作者文件夹命名格式模板（可配置） */
            authorFolderFormat: '{nickname}({uid})',
            
            /** ✅ 媒体类型文件夹名称（可配置） */
            mediaTypeFolders: {
                cover: '封面',
                video: '视频',
                imagePost: '图集'
            },
            
            /** ✅ 文件命名格式（可配置） */
            fileNameFormats: {
                cover: '{workId}_cover.jpg',
                video: '{workId}.mp4',
                image: '{workId}_{index}.jpg',  // index 从 1 开始，两位补齐
                music: '{workId}.mp3'
            },

            /** 文件名最大长度（超过会截断） */
            maxFilenameLength: 100,
            
            /** 禁止的文件名字符（正则表达式） */
            forbiddenChars: /[<>:"\/\\|?*]/g
        }
    }
};

/**
 * 获取指定平台的 API 端点配置
 * @param {string} platform - 平台名称（默认为当前激活平台）
 * @returns {Object} 平台特定的 API 端点配置
 * @throws {Error} 如果平台不受支持
 */
export function getPlatformEndpoints(platform = CONFIG.ACTIVE_PLATFORM) {
    if (!CONFIG.SUPPORTED_PLATFORMS.includes(platform)) {
        throw new Error(`不支持的平台: ${platform}。支持的平台: ${CONFIG.SUPPORTED_PLATFORMS.join(', ')}`);
    }
    
    return CONFIG.API_ENDPOINTS[platform];
}

/**
 * 验证平台是否受支持
 * @param {string} platform - 平台名称
 * @returns {boolean} 是否支持
 */
export function isPlatformSupported(platform) {
    return CONFIG.SUPPORTED_PLATFORMS.includes(platform);
}

/**
 * 获取所有支持的平台列表
 * @returns {Array<string>} 支持的平台名称数组
 */
export function getSupportedPlatforms() {
    return [...CONFIG.SUPPORTED_PLATFORMS];
}
