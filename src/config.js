// ==========================================
// 設定・定数 Definition
// ==========================================

// TODO: 環境に合わせてIDを設定してください
const CONFIG = {
    // 録音ファイルをアップロードするフォルダのID
    UPLOAD_FOLDER_ID: 'YOUR_UPLOAD_FOLDER_ID',

    // カテゴリ別フォルダを格納する親フォルダ（「録音_ARCHIVE」フォルダなど）のID
    // 未設定の場合はアップロードフォルダと同じ場所に作成されます（※運用上は分けたほうが良いです）
    CATEGORY_ROOT_FOLDER_ID: 'YOUR_CATEGORY_ROOT_FOLDER_ID',

    // 録音管理用スプレッドシートのID
    SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',
    // スプレッドシートのシート名
    SHEET_NAME: 'シート1',

    // GoogleカレンダーID (例: 'primary' または 'x...x@group.calendar.google.com')
    CALENDAR_ID: 'YOUR_CALENDAR_ID'
};

// スケジュール定義 (1:月, 2:火, 3:水, 4:木, 5:金, 6:土, 7:日)
// 文脈に合わせて「科目名」や「会議名」を subject に設定してください
const SCHEDULE = {
    1: [ // 月曜日
        { period: '朝', start: '09:00', end: '10:00', subject: '定例会議' },
        { period: '昼', start: '13:00', end: '15:00', subject: 'プロジェクトA研究' },
    ],
    2: [ // 火曜日
        { period: '午後', start: '13:00', end: '14:30', subject: '勉強会' },
    ],
    // 3: 水, 4: 木, 5: 金
    6: [ // 土曜日
        { period: '午前', start: '10:00', end: '12:00', subject: '週末ハッカソン' },
    ],
    7: [ // 日曜日
        // 必要に応じて定義
    ]
};
