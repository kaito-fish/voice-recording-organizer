# このスクリプトは Google Colab 上で実行することを想定しています。
# 必要なライブラリのインストール
# !pip install git+https://github.com/openai/whisper.git
# !pip install gspread oauth2client google-api-python-client

import os
import torch
import whisper
import gspread
from google.colab import auth
from google.auth import default
from google.colab import drive
import datetime

# ==========================================
# 設定
# ==========================================
SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'
SHEET_NAME = 'シート1'
# Google Driveのマウントパス
DRIVE_MOUNT_PATH = '/content/drive'

# ==========================================
# Main Process
# ==========================================

def main():
    # 1. Drive Mount
    if not os.path.exists(DRIVE_MOUNT_PATH):
        drive.mount(DRIVE_MOUNT_PATH)

    # 2. Authentication & Spreadsheet Client
    auth.authenticate_user()
    creds, _ = default()
    gc = gspread.authorize(creds)

    try:
        wb = gc.open_by_key(SPREADSHEET_ID)
        sheet = wb.worksheet(SHEET_NAME)
    except Exception as e:
        print(f"Error opening spreadsheet: {e}")
        return

    # 3. Load Data
    # 全データを取得 (get_all_records はヘッダーがあること前提)
    # ヘッダー行: [RecordID, FileName, FileID, Category, Date, Day, StartTime, FileUrl, Status, TranscriptID]
    # カラム名は GAS 側の出力と一致している必要がありますが、ここではインデックスまたは名前で簡易アクセスします。
    
    rows = sheet.get_all_values()
    if not rows:
        print("No data found in spreadsheet.")
        return

    header = rows[0]
    data = rows[1:]

    # カラムインデックスの特定 (名前で探す)
    try:
        col_idx_status = header.index("ステータス") # GAS側で書き込むカラム名要確認
        # もしGAS側でヘッダー行を作っていない場合は、手動で列番号を指定する必要があります。
        # 今回はGASコードでヘッダー行生成を含めていないため、運用で1行目にヘッダーがある前提とします。
        
        # 必要なカラムのインデックス (0始まり)
        # MD記述順: ID, Name, FileID, Category, Date, Day, Time, Path, Status, TranscriptID
        # Statusは9番目 (index 8), TranscriptIDは10番目 (index 9)
        # 安全のため、ヘッダー名を「文字起こしステータス」などで検索します。
        
        # ヘッダーが見つからない場合のフォールバック
        idx_status = -1
        idx_ts_id = -1
        idx_file_url = -1
        idx_category = -1
        idx_date = -1
        idx_file_id = -1
        idx_file_name = -1

        for i, col_name in enumerate(header):
            if "ステータス" in col_name: idx_status = i
            if "文字起こし" in col_name and "ID" in col_name: idx_ts_id = i
            if "URL" in col_name or "パス" in col_name: idx_file_url = i
            if "科目" in col_name or "カテゴリ" in col_name: idx_category = i
            if "日付" in col_name: idx_date = i
            if col_name == "FileID" or "ファイルID" in col_name: idx_file_id = i
            if "ファイル名" in col_name or col_name == "Name": idx_file_name = i
        
        # 必須カラムチェック
        missing = []
        if idx_status == -1: missing.append('ステータス')
        if idx_file_id == -1: missing.append('FileID')
        if idx_file_name == -1: missing.append('ファイル名')
        if missing:
            print(f"Error: Required column(s) not found: {', '.join(missing)}")
            return

    except ValueError:
        print("Error parsing header.")
        return

    # 4. Filter & Process
    # Whisperモデルのロード (初回はダウンロード走る)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    model = whisper.load_model("medium", device=device) # base, small, medium, large

    # バッチ更新用のリスト
    updates = []

    for row_idx, row in enumerate(data):
        # 行番号は header(1) + row_idx + 1 (1-based for gspread) -> row_idx + 2
        actual_row_num = row_idx + 2
        
        status = row[idx_status]
        
        if status == "未実行":
            file_url = row[idx_file_url]
            category = row[idx_category] if idx_category != -1 else "Unknown"
            date_str = row[idx_date] if idx_date != -1 else "Unknown"

            print(f"Processing Row {actual_row_num}: {category} ({date_str})")
            
            # File URLからファイルパスを特定するのは実は難しい（DriveのマウントパスとURLは直接変換できない）
            # そのため、ファイルIDを使うか、ファイル名検索をする必要がある。
            # 今回は GAS が「カテゴリ別フォルダ」に移動しているため、
            # /content/drive/MyDrive/録音_ARCHIVE/{Category}/{FileName} 
            # のようにパスが予測できるならそれを使う。
            # URLからFileIDを抽出してダウンロードする方が確実だが、ColabなのでDriveマウントパス経由で開きたい。
            
            # ここでは「ファイル名」を使って検索する簡易実装、もしくは
            # google-api-python-client で ID からダウンロードして一時保存する方法が確実。
            # FileIDカラムがあると仮定 (MDによればある)
            
            # 行データからFileIDとファイル名を取得 (ヘッダー名で検索済みのインデックスを使用)
            file_id = row[idx_file_id]
            file_name = row[idx_file_name]
            
            # Whisper実行
            transcript_text = run_transcription(model, file_id, file_name)
            
            if transcript_text:
                # 保存
                # テキストファイルとして保存 (本来はDriveの正しいフォルダに戻すべき)
                # ファイルIDから親フォルダがわかればいいが、ここは簡易的に
                # 「同じフォルダに置く」ためにIDベースではなく、
                # 処理用に一時パスに保存 -> Drive APIでアップロード or Driveマウントパス書き込み
                
                # パス解決が面倒なので、単純にテキストファイルを作成して、
                # upload codeを書くか、ローカル(Colab上)で完結させる。
                # ここでは文字起こしテキストを作成し、テキストファイルの中身を表示するにとどめるか、
                # Driveへ書き戻すロジック（パス指定）が必要。
                
                # 簡易実装: "/content/drive/MyDrive/録音_ARCHIVE/{category}/transcripts/" に集約保存する、など。
                # フォルダ名が正確にわからないと失敗するため、ここでは安全にトップ直下などの固定パスか、
                # ディレクトリ構造をあえて作らずに保存する例とする。もっとも確実なのはIDから親フォルダを取ること。
                
                # 運用上、カテゴリフォルダ名＝category変数なので（リネームロジックがそうなので）
                # 以下でトライする。
                save_path = f"/content/drive/MyDrive/録音_ARCHIVE/{category}/{date_str}_{category}_transcript.txt"
                
                try:
                    # 親切にディレクトリ作る
                    os.makedirs(os.path.dirname(save_path), exist_ok=True)
                    
                    with open(save_path, "w", encoding="utf-8") as f:
                        f.write(transcript_text)
                    
                    print(f"Saved transcript to: {save_path}")
                    
                    # 5. Update Spreadsheet (バッチ更新用にリストへ追加)
                    status_cell = gspread.utils.rowcol_to_a1(actual_row_num, idx_status + 1)
                    updates.append({'range': status_cell, 'values': [['完了']]})
                    if idx_ts_id != -1:
                        ts_cell = gspread.utils.rowcol_to_a1(actual_row_num, idx_ts_id + 1)
                        updates.append({'range': ts_cell, 'values': [[save_path]]})
                        
                except Exception as e:
                    print(f"Error saving/updating: {e}")

    # 6. バッチ更新実行
    if updates:
        try:
            sheet.batch_update(updates)
            print(f"Spreadsheet updated: {len(updates)} cells")
        except Exception as e:
            print(f"Error in batch update: {e}")

def run_transcription(model, file_id, file_name):
    print(f"Transcribing {file_name}...")
    
    downloaded_file_path = f"/content/{file_name}"
    
    # Google API Client を使用してダウンロード
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    import io

    # 既存の認証情報を使用
    creds, _ = default()
    drive_service = build('drive', 'v3', credentials=creds)
    
    try:
        request = drive_service.files().get_media(fileId=file_id)
        fh = io.FileIO(downloaded_file_path, 'wb')
        downloader = MediaIoBaseDownload(fh, request)
        
        done = False
        while done is False:
            status, done = downloader.next_chunk()
            # print(f"Download {int(status.progress() * 100)}%.")

        # Whisper実行
        result = model.transcribe(downloaded_file_path, verbose=False, language='ja')
        
        # タイムスタンプ付きで整形
        formatted_text = ""
        for segment in result["segments"]:
            start = str(datetime.timedelta(seconds=int(segment['start'])))
            text = segment['text']
            formatted_text += f"[{start}] {text}\n"
            
        return formatted_text
        
    except Exception as e:
        print(f"Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        if os.path.exists(downloaded_file_path):
            os.remove(downloaded_file_path)

if __name__ == "__main__":
    main()