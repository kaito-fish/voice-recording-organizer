// ==========================================
// Main Functions
// ==========================================

/**
 * メイン関数: 定期実行トリガーで呼び出される想定
 * アップロードフォルダを監視し、リネーム・移動・台帳記入を行う
 */
function processAudioFiles() {
    const uploadFolder = DriveApp.getFolderById(CONFIG.UPLOAD_FOLDER_ID);
    const tz = 'Asia/Tokyo';

    // 台帳に記録済みのFileID→カテゴリ名を取得（リネーム後に移動だけ失敗したファイルの救済に使う）
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    const loggedFileCategories = getLoggedFileCategories(sheet);

    // 未処理ファイルを収集
    // ファイル名が「処理済みっぽい」形式でもスキップしない: リネームは成功したが
    // 移動や台帳記録が失敗して INBOX に残っているだけの可能性があるため、
    // 実際に処理済みかどうかは台帳（loggedFileCategories）で判定する。
    const entries = [];
    const iter = uploadFolder.getFiles();
    while (iter.hasNext()) {
        const file = iter.next();
        const dateFromFileName = parseDateFromFilename(file.getName());

        // 録音日時を確定（ソートキーに使用）
        const recordingDate = dateFromFileName || getRecordingDate(file);
        entries.push({ file, dateFromFileName, recordingDate });
    }

    // 録音日時の昇順でソート
    entries.sort((a, b) => a.recordingDate.getTime() - b.recordingDate.getTime());

    for (const { file, dateFromFileName } of entries) {
        processSingleFile(file, tz, dateFromFileName, loggedFileCategories);
    }
}

/**
 * 台帳（スプレッドシート）に記録済みの FileID とカテゴリ名の対応を取得する
 */
function getLoggedFileCategories(sheet) {
    const map = new Map();
    if (!sheet) return map;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return map;

    // カラム構成: A:レコードID, B:ファイル名, C:FileID, D:カテゴリ名, ...
    const rows = sheet.getRange(2, 3, lastRow - 1, 2).getValues();
    for (const [fileId, categoryName] of rows) {
        if (fileId) map.set(fileId, categoryName);
    }
    return map;
}

/**
 * ファイル名から日時を抽出する
 * 対応フォーマット:
 * 1. YYYY-MM-DD_HH-mm-ss (例: 2024-05-20_09-30-00)
 * 2. YYYYMMDD_HHMMSS     (例: 20240520_093000)
 * 3. YYYYMMDDHHMMSS      (例: 20240520093000)
 */
function parseDateFromFilename(filename) {
    // Pattern 1: YYYY-MM-DD_HH-mm-ss
    let match = filename.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
        return new Date(
            parseInt(match[1], 10),
            parseInt(match[2], 10) - 1,
            parseInt(match[3], 10),
            parseInt(match[4], 10),
            parseInt(match[5], 10),
            parseInt(match[6], 10)
        );
    }

    // Pattern 2: YYYYMMDD_HHMMSS
    match = filename.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (match) {
        return new Date(
            parseInt(match[1], 10),
            parseInt(match[2], 10) - 1,
            parseInt(match[3], 10),
            parseInt(match[4], 10),
            parseInt(match[5], 10),
            parseInt(match[6], 10)
        );
    }

    // Pattern 3: YYYYMMDDHHMMSS (No separators)
    match = filename.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (match) {
        return new Date(
            parseInt(match[1], 10),
            parseInt(match[2], 10) - 1,
            parseInt(match[3], 10),
            parseInt(match[4], 10),
            parseInt(match[5], 10),
            parseInt(match[6], 10)
        );
    }

    return null;
}

/**
 * 個別のファイルを処理する
 */
function processSingleFile(file, tz, dateFromFileName, loggedFileCategories) {
    try {
        // 台帳に既に記録済み = リネームと記録は完了しているが、移動だけが失敗して
        // INBOX に残っているケース。再度リネームや記録をやり直さず、移動だけ再試行する。
        const loggedCategory = loggedFileCategories.get(file.getId());
        if (loggedCategory !== undefined) {
            console.warn(`Recovering stuck file (already logged, retrying move only): ${file.getName()} (${file.getId()})`);
            const targetFolder = getOrCreateCategoryFolder(loggedCategory);
            file.moveTo(targetFolder);
            console.log(`Recovered move to: ${loggedCategory}`);
            return;
        }

        const recordingDate = dateFromFileName || getRecordingDate(file);
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

        // 1. フォルダを先に取得（連番決定に使用）
        const targetFolder = getOrCreateCategoryFolder(categoryName);

        // 2. 同じ予定内の既存ファイルを確認して連番を決定
        const num = getNextFileNumber(targetFolder, newBaseName, ext);
        const newName = `${newBaseName}_${String(num).padStart(2, '0')}${ext}`;

        // 3. リネーム
        file.setName(newName);
        console.log(`Renamed: ${newName}`);

        // 4. スプレッドシートへ記録（移動より先に行う）
        // ここで先に台帳へ記録しておくことで、この後の移動が失敗しても
        // 次回実行時に loggedFileCategories 経由で移動だけを再試行でき、
        // 「リネーム済みだが未記録・未移動のまま迷子になる」事態を防ぐ。
        logToSpreadsheet(file, categoryName, scheduleInfo, recordingDate, tz);
        console.log(`Logged to spreadsheet: ${newName}`);

        // 5. フォルダ移動
        file.moveTo(targetFolder);
        console.log(`Moved to: ${categoryName}`);

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
    // 1. Googleカレンダーから予定を取得 (優先)
    const calendarEvent = getCalendarEvent(date, tz);
    if (calendarEvent) {
        return calendarEvent;
    }

    // 2. カレンダーになければ固定スケジュールを確認 (フォールバック)
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
 * フォルダ名・ファイル名として使えない記号を除去する
 */
function sanitizeCategoryName(name) {
    return name.replace(/[\/\\:*?"<>|]/g, '_');
}

/**
 * Googleカレンダーから指定時刻のイベントを取得する
 */
function getCalendarEvent(date, tz) {
    if (!CONFIG.CALENDAR_ID || CONFIG.CALENDAR_ID === 'YOUR_CALENDAR_ID') {
        return null;
    }

    try {
        const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
        if (!calendar) {
            console.warn(`Calendar not found: ${CONFIG.CALENDAR_ID}`);
            return null;
        }

        // dateの時点で開催中のイベントを取得
        const events = calendar.getEventsForDay(date);

        // 該当時刻を含むイベントを探す
        const timeValue = date.getTime();

        for (const event of events) {
            // 終日イベントは除外
            if (event.isAllDayEvent()) continue;

            const start = event.getStartTime().getTime();
            const end = event.getEndTime().getTime();

            // 録音開始時刻がイベント期間内に含まれるか
            if (start <= timeValue && timeValue < end) {
                return {
                    subject: sanitizeCategoryName(event.getTitle()),
                    period: 'Calendar', // 固定スケジュールのperiodの代わり
                    start: Utilities.formatDate(event.getStartTime(), tz, 'HH:mm'),
                    end: Utilities.formatDate(event.getEndTime(), tz, 'HH:mm')
                };
            }
        }
    } catch (e) {
        console.error(`Error fetching calendar events: ${e.message}`);
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
 * 移動先フォルダ内の同一ベース名ファイルを確認し、次の連番を返す
 * 例: baseName=2024-05-20_定例会議, ext=.m4a の場合
 *   _01.m4a が存在すれば 2 を返す
 *   何も存在しなければ 1 を返す
 */
function getNextFileNumber(folder, baseName, ext) {
    let maxNum = 0;
    const files = folder.getFiles();
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedBase}_(\\d+)${escapedExt}$`);

    while (files.hasNext()) {
        const match = files.next().getName().match(pattern);
        if (match) {
            maxNum = Math.max(maxNum, parseInt(match[1], 10));
        }
    }
    return maxNum + 1;
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

/**
 * 検証用: カレンダー連携テスト
 * GASエディタ上でこの関数を実行し、ログを確認してください。
 */
function testCalendarIntegration() {
    // テスト用の日時 (現在日時など)
    const testDate = new Date();
    const tz = 'Asia/Tokyo';

    console.log(`Testing calendar fetch for: ${testDate}`);
    const result = getCalendarEvent(testDate, tz);

    if (result) {
        console.log('Event found:', result);
    } else {
        console.log('No event found for this time.');
        if (CONFIG.CALENDAR_ID === 'YOUR_CALENDAR_ID') {
            console.warn('CONFIG.CALENDAR_ID is not set.');
        }
    }
}
