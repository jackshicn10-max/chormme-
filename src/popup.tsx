function IndexPopup() {
  return (
    <div
      style={{
        minWidth: 280,
        padding: 14,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        color: "#0f172a"
      }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 16 }}>YouTube 生词工具</h1>
      <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.4 }}>
        在 YouTube 视频页的字幕面板里右键单词即可保存。
      </p>
      <button
        type="button"
        onClick={() => {
          chrome.tabs.create({ url: chrome.runtime.getURL("tabs/vocab.html") })
        }}>
        打开生词本
      </button>
    </div>
  )
}

export default IndexPopup
