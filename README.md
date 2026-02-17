# 音声録音自動整理＆文字起こしシステム

ミーティング、勉強会、講義、インタビューなどの録音ファイルを Google Drive にアップロードするだけで、スケジュールに基づいて自動的にリネーム・整理し、文字起こしまで行うシステムです。

## 機能

1.  **自動整理 (GAS)**
    *   アップロード用フォルダを定期監視
    *   ファイルの作成日時をもとに、**Googleカレンダーの予定** または **定例スケジュール定義** から「カテゴリ名（会議名・科目名など）」を特定
    *   ファイルを `YYYY-MM-DD_カテゴリ名.m4a` 等にリネーム
    *   カテゴリごとのフォルダへ自動移動（フォルダがない場合は自動作成）
    *   Google スプレッドシートへ台帳記録

2.  **文字起こし (Google Colab + Whisper)**
    *   スプレッドシートの「未実行」データを読み込み
    *   OpenAI Whisper で高精度な文字起こしを実行（日本語対応）
    *   タイムスタンプ付きのテキストファイルとして保存（例: `[00:00:10] 音声の内容...`）
    *   スプレッドシートのステータスを「完了」に更新

## ファイル構成

```text
.
├── src/
│   ├── main.js                  # Google Apps Script (ファイル整理・台帳記録ロジック)
│   └── colab_transcription.py   # Python Script (Google Colab用文字起こし)
├── appsscript.json              # GAS 設定ファイル
└── README.md                    # 本ファイル
```

## 開発環境構築 (clasp)

このプロジェクトは Google Apps Script (GAS) のローカル開発ツール [clasp](https://github.com/google/clasp) を使用しています。

### 1. 準備
Node.js 環境にて以下を実行します。

1.  [Google Apps Script API 設定ページ](https://script.google.com/home/usersettings) にアクセスし、「Google Apps Script API」を **オン** にします（これを行わないとログインやPushが失敗します）。
2.  以下のコマンドでインストールとログインを行います。
    ```bash
    npm install -g @google/clasp
    clasp login
    ```

### 2. プロジェクトの紐付け
*   **既存の GAS プロジェクトがある場合**:
    ```bash
    clasp clone <Script ID> --rootDir ./src
    ```
*   **新規作成する場合**:
    ```bash
    clasp create --title "VoiceOrganizer" --type standalone --rootDir ./src
    ```

### 3. 反映 (Push / Pull)
*   ローカルの変更をアップロード: `clasp push`
*   ブラウザ上の変更をダウンロード: `clasp pull`

## セットアップ手順

### 1. Google Drive & スプレッドシートの準備
1.  **アップロード用フォルダ** を作成します（例: `録音_INBOX`）。
2.  **保存用親フォルダ** を作成します（例: `録音_ARCHIVE`）。ここにカテゴリ別フォルダが作られます。
3.  **管理用スプレッドシート** を作成します。
    *   シート名: `シート1`（デフォルト）
    *   1行目に以下のヘッダーを作成することを推奨します（必須ではありませんが、視認性が向上します）。
        *   `ID`, `ファイル名`, `FileID`, `カテゴリ名`, `日付`, `曜日`, `開始時刻`, `URL`, `ステータス`, `文字起こしID`

#### Google Drive フォルダ構成イメージ

以下のようにフォルダを作成・配置すると管理しやすくなります。

```text
マイドライブ/
├── 録音_INBOX/          <-- [1] ここに録音ファイルをアップロード (UPLOAD_FOLDER_ID)
├── 録音_ARCHIVE/        <-- [2] 整理後の保存先 (CATEGORY_ROOT_FOLDER_ID)
│   ├── 定例会議/        <-- (自動作成されるカテゴリフォルダ)
│   │   └── 2024-05-20_定例会議.m4a
│   ├── プロジェクトA/
│   └── 未分類/
└── 録音管理台帳           <-- [3] 管理用スプレッドシート (SPREADSHEET_ID)
```

### 2. Google Apps Script (GAS) の設定
1.  このリポジトリを `clasp push` して GAS プロジェクトに反映します。
2.  `src/main.js` の `CONFIG` 変数を編集し、自身の環境に合わせてIDを設定します。
    ```javascript
    const CONFIG = {
      UPLOAD_FOLDER_ID: '...',       // アップロード用フォルダID
      CATEGORY_ROOT_FOLDER_ID: '...', // 保存用親フォルダID
      SPREADSHEET_ID: '...',         // スプレッドシートID
      SHEET_NAME: 'シート1',
      CALENDAR_ID: 'primary'         // GoogleカレンダーID (例: 'primary' または '...group.calendar.google.com')
    };
    ```
3.  GAS エディタ上で、`processAudioFiles` 関数を **時間主導型トリガー**（例: 5分～1時間おき）に設定します。

### 3. Google Colab (文字起こし) の利用
1.  Google Colab で新規ノートブックを作成します。
2.  `src/colab_transcription.py` の内容をコードセルに貼り付けます。
3.  スクリプト冒頭の `SPREADSHEET_ID` を設定します。
4.  必要なライブラリをインストールするため、以下のコマンドを別のセルで一度実行します。
    ```python
    !pip install git+https://github.com/openai/whisper.git
    !pip install gspread oauth2client google-api-python-client
    ```
5.  ノートブックを実行し、Google Drive のマウント許可を与えると、文字起こし処理が開始されます。

## 使い方 (Usage)

### 1. 自動実行
セットアップ時に設定したトリガー（時間主導型）により、定期的にフォルダが監視され、自動で整理・文字起こしフローが実行されます。

### 2. 手動実行（すぐに整理したい場合）
開発中やテスト、あるいはすぐに整理を実行したい場合は、以下の手順で手動実行できます。

1.  Google Apps Script エディタを開きます（`clasp open` またはブラウザからアクセス）。
2.  ツールバーの関数選択ボックス（デフォルトで `myFunction` などになっている箇所）から **`processAudioFiles`** を選択します。
3.  **「実行」** ボタンをクリックします。
4.  実行ログに `Renamed: ...` や `Moved to: ...` と表示されれば成功です。

## スケジュールとカレンダー連携

このシステムは以下の優先順位でカテゴリ名（会議名・科目名）を決定します。

1.  **Google カレンダー** (`CALENDAR_ID` で設定したカレンダー)
    *   `'primary'` を指定した場合は、**スクリプト実行ユーザー自身のメインカレンダー**が参照されます。
    *   特定の共有カレンダーなどを参照したい場合は、そのカレンダーID（`...group.calendar.google.com` 形式）を指定してください。
    *   録音日時と重なる予定がある場合、その予定タイトルがカテゴリ名になります。
2.  **定例スケジュール** (`src/main.js` 内の `SCHEDULE` 定数)
    *   カレンダーに予定がない場合、曜日と時間帯に基づいて `SCHEDULE` 定数からカテゴリ名を決定します。

### 定例スケジュールの設定 (`src/main.js`)

*   `SCHEDULE` 定数を編集して、自身の定例スケジュールに合わせてください。
*   `1` が月曜日、`2` が火曜日... `7` が日曜日です（GASの仕様に準拠）。
*   `subject` には会議名や科目名などを設定します。

## 注意事項 / Policy
*   **私的利用限定**: このツールは学習・業務支援を目的としています。
*   **許可**: ミーティング、講義、勉強会などを録音する際は、必ず主催者や参加者の許可を得てください。
*   **データ保護**: 生成されたテキストや音声データには個人情報が含まれる可能性があります。無断で公開したり、共有設定を誤ったりしないよう十分注意してください。