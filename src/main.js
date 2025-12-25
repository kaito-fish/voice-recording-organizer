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
    SHEET_NAME: 'シート1'
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

// ==========================================
// Main Functions
// ==========================================

/**
 * メイン関数: 定期実行トリガーで呼び出される想定
 * アップロードフォルダを監視し、リネーム・移動・台帳記入を行う
 */
function processAudioFiles() {
    const uploadFolder = DriveApp.getFolderById(CONFIG.UPLOAD_FOLDER_ID);
    const files = uploadFolder.getFiles();
    const tz = 'Asia/Tokyo';

    while (files.hasNext()) {
        const file = files.next();
        const currentName = file.getName();

        // 既に処理済み（"YYYY-MM-DD_" 形式）の場合はスキップ
        // ※正規表現は簡易的な判定です
        if (/^\d{4}-\d{2}-\d{2}_/.test(currentName)) {
            continue;
        }

        processSingleFile(file, tz);
    }
}

/**
 * 個別のファイルを処理する
 */
function processSingleFile(file, tz) {
    try {
        const recordingDate = getRecordingDate(file);
        // 日付判定用に整形
        const ymd = Utilities.formatDate(recordingDate, tz, 'yyyy-MM-dd');

        // スケジュール判定
        const scheduleInfo = getScheduleInfo(recordingDate, tz);

        // 新しいファイル名の決定
        let newBaseName;
        let categoryName;

        if (scheduleInfo) {
            categoryName = scheduleInfo.subject;
            newBaseName = `${ymd}_${scheduleInfo.subject}`;
            // 必要であれば時限もファイル名に含める: `${ymd}_${scheduleInfo.subject}_${scheduleInfo.period}`
        } else {
            categoryName = '未分類';
            const timeLabel = Utilities.formatDate(recordingDate, tz, 'HHmm');
            newBaseName = `${ymd}_未分類_${timeLabel}`;
        }

        // 拡張子の維持
        const dotIndex = file.getName().lastIndexOf('.');
        let ext = '';
        if (dotIndex !== -1) {
            ext = file.getName().substring(dotIndex);
        }
        const newName = newBaseName + ext;

        // 1. リネーム
        file.setName(newName);
        console.log(`Renamed: ${newName}`);

        // 2. フォルダ移動
        const targetFolder = getOrCreateCategoryFolder(categoryName);
        file.moveTo(targetFolder);
        console.log(`Moved to: ${categoryName}`);

        // 3. スプレッドシートへ記録
        logToSpreadsheet(file, categoryName, scheduleInfo, recordingDate, tz);

    } catch (e) {
        console.error(`Error processing file ${file.getId()}: ${e.message}`);
    }
}

// ==========================================
// Helper Functions
// ==========================================

/**
 * 作成日時からスケジュール情報を取得する
 */
function getScheduleInfo(date, tz) {
    // Utilities.formatDate の 'u' は 1=Monday, ..., 7=Sunday
    const dayStr = Utilities.formatDate(date, tz, 'u');
    let dayNum = parseInt(dayStr, 10);

    const timeStr = Utilities.formatDate(date, tz, 'HH:mm');
    const slots = SCHEDULE[dayNum] || [];

    for (const slot of slots) {
        if (slot.start <= timeStr && timeStr < slot.end) {
            return slot; // {subject, period, start, end}
        }
    }
    return null;
}

/**
 * 録音日時の推定
 * Driveに一括アップロードされた場合は作成日時がアップロード時刻になるため、
 * 作成日時と更新日時のうち古い方を採用する。
 */
function getRecordingDate(file) {
    const created = file.getDateCreated();
    const updated = file.getLastUpdated();
    return created.getTime() <= updated.getTime() ? created : updated;
}

/**
 * カテゴリ名のフォルダを取得、なければ作成する
 */
function getOrCreateCategoryFolder(categoryName) {
    // カテゴリフォルダの親フォルダ（指定がなければアップロードフォルダと同じ場所を使うなどの救済措置）
    const parentFolderId = CONFIG.CATEGORY_ROOT_FOLDER_ID || CONFIG.UPLOAD_FOLDER_ID;
    const parentFolder = DriveApp.getFolderById(parentFolderId);

    const folders = parentFolder.getFoldersByName(categoryName);
    if (folders.hasNext()) {
        return folders.next();
    } else {
        return parentFolder.createFolder(categoryName);
    }
}

/**
 * スプレッドシートにメタデータを記録する
 */
function logToSpreadsheet(file, categoryName, scheduleInfo, dateObj, tz) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
        console.error(`Sheet "${CONFIG.SHEET_NAME}" not found.`);
        return;
    }

    // カラム構成:
    // レコードID, ファイル名, FileID, カテゴリ名, 日付, 曜日, 開始推定時刻, パス, ステータス, 文字起こしID

    const recordId = Utilities.getUuid();
    const fileName = file.getName();
    const fileId = file.getId();
    const ymd = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
    const dayOfWeek = Utilities.formatDate(dateObj, tz, 'E'); // Mon, Tue...

    const startTime = Utilities.formatDate(dateObj, tz, 'HH:mm:ss');
    const fileUrl = file.getUrl();

    // 文字起こしステータス
    const transcriptStatus = '未実行';
    const transcriptFileId = '';

    sheet.appendRow([
        recordId,
        fileName,
        fileId,
        categoryName,
        ymd,
        dayOfWeek,
        startTime,
        fileUrl,
        transcriptStatus,
        transcriptFileId
    ]);
}
