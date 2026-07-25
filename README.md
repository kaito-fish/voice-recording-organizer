# 音声録音自動整理＆文字起こしシステム

ミーティング、勉強会、講義、インタビューなどの録音ファイルを Google Drive にアップロードするだけで、スケジュールに基づいて自動的にリネーム・整理し、文字起こしまで行うシステムです。

## 機能

1.  **自動整理 (GAS)**
    *   アップロード用フォルダを定期監視
    *   ファイルの作成日時をもとに、**Googleカレンダーの予定** または **定例スケジュール定義** から「カテゴリ名（会議名・科目名など）」を特定
    *   ファイルを `YYYY-MM-DD_カテゴリ名_01.m4a` 等にリネーム（同一カテゴリ内で連番付与）
    *   カテゴリごとのフォルダへ自動移動（フォルダがない場合は自動作成）
    *   Google スプレッドシートへ台帳記録

2.  **文字起こし (Google Colab + Whisper)**
    *   スプレッドシートの「未実行」データを読み込み
    *   OpenAI Whisper で高精度な文字起こしを実行（日本語対応）
    *   **GPU (CUDA) 自動判定**: GPU が利用可能な場合は自動的に CUDA を使用し、高速に処理
    *   タイムスタンプ付きのテキストファイルとして保存（例: `[00:00:10] 音声の内容...`）
    *   スプレッドシートのステータスを「完了」に更新

## ファイル構成

```text
.
├── src/
│   ├── config.sample.js         # 設定・スケジュール定数のテンプレート（CONFIG / SCHEDULE）
│   ├── config.js                # config.sample.js をコピーして作成（gitignore対象・リポジトリには含まれない）
│   ├── main.js                  # Google Apps Script (ファイル整理・台帳記録ロジック)
│   ├── colab_transcription.ipynb # Google Colab用文字起こしノートブック
│   └── appsscript.json          # GAS 設定ファイル
├── tests/
│   └── main.test.js             # main.js の純粋関数に対する Jest テスト
├── .claspignore                 # clasp push 対象外ファイルの定義
├── package.json                 # テスト用の依存関係定義（clasp push 対象外）
└── README.md                    # 本ファイル
```

※ `.clasp.json`（Script ID を保持する clasp の設定ファイル）も gitignore 対象のため、リポジトリには含まれません。後述の手順で各自作成します。

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
*   **既存の GAS プロジェクトに紐付ける場合**:
    リポジトリのルートに `.clasp.json` を手動で作成し、Script ID を設定します。

    ```json
    {
      "scriptId": "<Script ID>",
      "rootDir": "src"
    }
    ```

    その後 `clasp push` でローカルのコードを反映します（GAS 側の既存ファイルをローカルの内容で完全に置き換える場合は `clasp push -f`）。

    > **注意**: `clasp clone` は使わないでください。`clasp clone` はリモート（GAS側）のファイルをダウンロードしてローカルに展開するコマンドのため、このリポジトリのファイルが上書きされたり、GAS 側の `コード.gs` などが混入したりします。また、`.clasp.json` が既にあるディレクトリでは実行自体がエラーになります。
*   **新規作成する場合**:
    ```bash
    clasp create --title "VoiceOrganizer" --type standalone --rootDir ./src
    ```
    （`.clasp.json` が自動生成されます）

### 3. 反映 (Push / Pull)
*   ローカルの変更をアップロード: `clasp push`
*   ブラウザ上の変更をダウンロード: `clasp pull`

## テスト

`main.js` 内の純粋関数（`parseDateFromFilename` / `getNextFileNumber`）は [Jest](https://jestjs.io/) でローカルテストできます。

```bash
npm install
npm test
```

テストコードは `tests/` 配下に置きます（`rootDir: src` の clasp push 対象には含まれません）。

## セットアップ手順

### 1. Google Drive & スプレッドシートの準備
1.  **アップロード用フォルダ** を作成します（例: `録音_INBOX`）。
2.  **保存用親フォルダ** をマイドライブ直下に `録音_ARCHIVE` という名前で作成します。ここにカテゴリ別フォルダが作られます。
    *   ※ Colab の文字起こしノートブックは保存先パスを `マイドライブ/録音_ARCHIVE/<カテゴリ名>/` に固定で参照しているため、フォルダ名・場所を変える場合はノートブック側（`save_path`）の修正も必要です。
3.  **管理用スプレッドシート** を作成します。
    *   シート名: `シート1`（デフォルト）
    *   1行目に以下のヘッダーを作成します。
        *   `ID`, `ファイル名`, `FileID`, `カテゴリ名`, `日付`, `曜日`, `開始時刻`, `URL`, `ステータス`, `文字起こしID`
    *   GAS（整理・台帳記録）だけならヘッダーは無くても動作しますが、Colab の文字起こしノートブックはヘッダー名でカラムを特定するため、**文字起こしまで使う場合は必須**です（少なくとも `ファイル名` / `FileID` / `ステータス` が無いとエラーで停止します）。

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
1.  `src/config.sample.js` をコピーして `src/config.js` を作成します（`config.js` は gitignore 対象のため、リポジトリには含まれていません）。
    ```bash
    cp src/config.sample.js src/config.js
    ```
2.  `src/config.js` の `CONFIG` 変数を編集し、自身の環境に合わせてIDを設定します。
    ```javascript
    const CONFIG = {
      UPLOAD_FOLDER_ID: '...',            // アップロード用フォルダID
      CATEGORY_ROOT_FOLDER_ID: '...',     // 保存用親フォルダID
      SPREADSHEET_ID: '...',              // スプレッドシートID
      SHEET_NAME: 'シート1',
      CALENDAR_ID: 'primary'              // GoogleカレンダーID (例: 'primary' または '...group.calendar.google.com')
    };
    ```
3.  `clasp push` でローカルのコードを GAS プロジェクトに反映します。
4.  GAS エディタ上で、`processAudioFiles` 関数を **時間主導型トリガー**（例: 5分～1時間おき）に設定します。

### 3. Google Colab (文字起こし) の利用
1.  Google Colab で `src/colab_transcription.ipynb` を開きます。
2.  **GPU ランタイムを有効化**します: メニューから `ランタイム` → `ランタイムのタイプを変更` → **GPU (T4)** を選択し保存します。
3.  設定セルの `SPREADSHEET_ID` を設定します。
4.  ノートブックを先頭のセルから順に実行します（先頭セルに必要なライブラリ・ffmpeg のインストールが含まれています）。Google Drive のマウント許可を与えると、文字起こし処理が開始されます。
    *   実行時に `Using device: cuda` と表示されれば GPU が正しく使用されています。
    *   `Using device: cpu` と表示される場合は、手順2の GPU ランタイム設定を確認してください。

## 使い方 (Usage)

### 1. 自動実行（整理・台帳記録）
セットアップ時に設定したトリガー（時間主導型）により、定期的にフォルダが監視され、リネーム・移動・台帳記録が自動で実行されます。
※ 自動実行されるのはここまでです。文字起こしは Google Colab でノートブックを手動実行してください（台帳の「未実行」行がまとめて処理されます）。

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
    *   **終日イベントは除外**されます（時刻指定のある予定のみが対象）。
2.  **定例スケジュール** (`src/config.js` 内の `SCHEDULE` 定数)
    *   カレンダーに予定がない場合、曜日と時間帯に基づいて `SCHEDULE` 定数からカテゴリ名を決定します。

### 定例スケジュールの設定 (`src/config.js`)

*   `SCHEDULE` 定数を編集して、自身の定例スケジュールに合わせてください。
*   `1` が月曜日、`2` が火曜日... `7` が日曜日です（GASの仕様に準拠）。
*   `subject` には会議名や科目名などを設定します。

## 注意事項 / Policy
*   **私的利用限定**: このツールは学習・業務支援を目的としています。
*   **許可**: ミーティング、講義、勉強会などを録音する際は、必ず主催者や参加者の許可を得てください。
*   **データ保護**: 生成されたテキストや音声データには個人情報が含まれる可能性があります。無断で公開したり、共有設定を誤ったりしないよう十分注意してください。