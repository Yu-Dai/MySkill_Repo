# 怎麼找入口

入口是「程式從外面被觸發的地方」。找入口的方法是搜尋**註冊動作**，不是猜哪些函式看起來重要。
入口的 `file`、`line` 寫註冊的那一行（沒有註冊動作時寫函式定義），`symbol` 寫那一行出現的文字。

## 三個階段

| 階段 | `phase` | 意思 |
| --- | --- | --- |
| 啟動 | `boot` | 程式開始執行到準備好為止。通常只有一到兩個入口 |
| 待命 | `run` | 準備好之後，等外面的事件來觸發。大部分入口在這裡 |
| 結束 | `exit` | 收尾並停止 |

從程式碼找不到某個階段的入口就留空，不要硬湊。

## 各類專案要搜尋什麼

### Linux 驅動程式（C）

| 階段 | 搜尋 | 說明 |
| --- | --- | --- |
| boot | `module_init`、`module_*_driver`、`.probe` | 模組載入、裝置配對 |
| run | `request_irq`、`request_threaded_irq`、`devm_request_*irq` | 中斷 |
| run | `INIT_WORK`、`INIT_DELAYED_WORK`、`timer_setup`、`hrtimer_init`、`kthread_run` | 延後執行與背景工作 |
| run | `file_operations`、`.unlocked_ioctl`、`.read`、`.write` | 使用者空間呼叫 |
| run | `DEVICE_ATTR`、`sysfs_create_group`、`proc_create`、`debugfs_create_*` | 除錯與設定節點 |
| run | `.suspend`、`.resume`、`dev_pm_ops`、`notifier_block` | 電源與通知 |
| run | `request_firmware`、`input_register_device` 之後的回呼 | 韌體載入、輸入子系統 |
| exit | `module_exit`、`.remove`、`.shutdown` | 卸載與關機 |

操作表（`struct xxx_ops = { ... }`）裡每一個有填的欄位都是一個入口。

### 韌體與裸機（C）

| 階段 | 搜尋 |
| --- | --- |
| boot | 重置向量、啟動檔（`startup_*.s`）、`main` |
| run | `main` 裡的主迴圈（當成一個入口）、中斷向量表裡每一個有實作的中斷服務函式 |
| exit | 通常沒有。有進入低功耗或重置的流程就列在這裡 |

### Windows 驅動程式

| 階段 | 搜尋 |
| --- | --- |
| boot | `DriverEntry`、`EvtDeviceAdd`、`EvtDevicePrepareHardware`、`EvtDeviceD0Entry` |
| run | `EvtIo*`、`EvtInterruptIsr`、`EvtInterruptDpc`、`EvtTimerFunc`、`EvtWorkItem` |
| exit | `EvtDeviceD0Exit`、`EvtDeviceReleaseHardware`、`EvtDriverUnload` |

### 桌面程式（C#、WinForms、WPF）

| 階段 | 搜尋 |
| --- | --- |
| boot | `static void Main`、`Application.Run`、主視窗的建構式與 `Load` |
| run | `+=` 註冊的事件、`.Designer.cs` 與 XAML 裡接上的處理函式、`Timer`、`BackgroundWorker`、`Task.Run`、序列埠與 USB 的資料到達事件 |
| exit | `FormClosing`、`Closed`、`Application.Exit`、`Dispose` |

按鈕很多時，一個按鈕一個入口。只做同一件事、差別只有參數的，可以合成一個入口並在 `trigger` 說明。

### 網頁前端

| 階段 | 搜尋 |
| --- | --- |
| boot | HTML 載入的進入腳本、`DOMContentLoaded`、框架的掛載（`createRoot`、`createApp`） |
| run | `addEventListener`、`on*` 屬性、路由表、`setInterval`、`fetch` 之後的處理、WebSocket 的 `onmessage` |
| exit | `beforeunload`、`pagehide`、`visibilitychange` |

### 後端服務

| 階段 | 搜尋 |
| --- | --- |
| boot | `main`、伺服器 `listen`、資料庫連線建立 |
| run | 路由註冊（`app.get`、`@app.route`、`[HttpGet]`）、訊息佇列的訂閱、排程工作 |
| exit | `SIGINT`、`SIGTERM` 的處理、關閉掛鉤 |

### 命令列工具與腳本

| 階段 | 搜尋 |
| --- | --- |
| boot | `main`、`if __name__ == "__main__"`、參數解析 |
| run | 每一個子命令是一個入口。沒有子命令時，主要流程就是唯一的入口，階段寫 `boot` |
| exit | 訊號處理、`atexit`、`finally` 裡的收尾 |

## 盤點完自我檢查

- 每一類註冊動作我都搜尋過了嗎？
- 建置設定有沒有把某些檔案排除在外？被排除的檔案裡的入口不算。
- 有沒有函式從來沒被註冊、也沒被呼叫？它不是入口，不要列。
- 入口名稱是使用者看得懂的事件（「觸控中斷」），不是函式名稱（`ts_irq_handler`）。
