import { useCallback, useEffect, useState } from "react"

import type {
  ClearTranslationCacheResponse,
  MessageResponse
} from "~lib/messages"
import { sendRuntimeMessage } from "~lib/messages"
import {
  DEFAULT_LEARNING_SETTINGS,
  sanitizeLearningSettings
} from "~lib/settings"
import type { LearningSettings } from "~types"

const cardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 16,
  background: "#fff",
  boxShadow: "0 12px 34px rgba(15, 23, 42, 0.06)"
}

const labelStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "center",
  padding: "12px 0",
  borderBottom: "1px solid #eef2f7"
}

const buttonStyle = {
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 9,
  padding: "7px 12px",
  cursor: "pointer",
  background: "#0f172a",
  color: "#fff",
  fontWeight: 700
}

const SettingsTab = () => {
  const [settings, setSettings] = useState<LearningSettings>(
    DEFAULT_LEARNING_SETTINGS
  )
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const response = await sendRuntimeMessage<LearningSettings>({
      type: "GET_SETTINGS",
      payload: {}
    })
    if (response.ok) {
      setSettings(sanitizeLearningSettings(response.data))
      setStatus(null)
    } else {
      setStatus("error" in response ? response.error : "加载设置失败")
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateSettings = (patch: Partial<LearningSettings>) => {
    setSettings((previous) => sanitizeLearningSettings({ ...previous, ...patch }))
  }

  const save = async () => {
    const response = await sendRuntimeMessage<LearningSettings>({
      type: "SAVE_SETTINGS",
      payload: settings
    })
    if (!response.ok) {
      setStatus("error" in response ? response.error : "保存设置失败")
      return
    }

    setSettings(response.data)
    setStatus("设置已保存。YouTube 页面刷新后会应用默认开关；字幕提前量和查词开关通常重新打开 LT 后生效。")
  }

  const clearCache = async () => {
    const response: MessageResponse<ClearTranslationCacheResponse> =
      await sendRuntimeMessage({
        type: "CLEAR_TRANSLATION_CACHE",
        payload: {}
      })
    setStatus(
      response.ok
        ? "翻译缓存已清空。"
        : "error" in response
          ? response.error
          : "清空缓存失败"
    )
  }

  return (
    <main
      style={{
        margin: "0 auto",
        maxWidth: 860,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        padding: "28px 20px",
        color: "#0f172a",
        background: "#f8fafc",
        minHeight: "100vh"
      }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 26 }}>YouTube 学习工具设置</h1>
      <p style={{ margin: "0 0 20px", color: "#64748b" }}>
        这些设置保存在浏览器本地，只影响本插件。
      </p>

      <section style={cardStyle}>
        {loading && <div style={{ color: "#64748b" }}>加载中...</div>}
        {!loading && (
          <>
            <label style={labelStyle}>
              <span>
                <strong>进入 YouTube 视频页后默认打开 LT</strong>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  关闭时需要手动点播放器里的 LT OFF。
                </div>
              </span>
              <input
                type="checkbox"
                checked={settings.defaultLearningToolsEnabled}
                onChange={(event) =>
                  updateSettings({
                    defaultLearningToolsEnabled: event.currentTarget.checked
                  })
                }
              />
            </label>

            <label style={labelStyle}>
              <span>
                <strong>启用鼠标悬停查词</strong>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  关闭后右键保存仍然可用。
                </div>
              </span>
              <input
                type="checkbox"
                checked={settings.enableHoverTranslation}
                onChange={(event) =>
                  updateSettings({
                    enableHoverTranslation: event.currentTarget.checked
                  })
                }
              />
            </label>

            <label style={labelStyle}>
              <span>
                <strong>字幕加载后预热当前视频单词</strong>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  先查内置词典和缓存，再低频补在线释义。
                </div>
              </span>
              <input
                type="checkbox"
                checked={settings.enableTranslationPrewarm}
                onChange={(event) =>
                  updateSettings({
                    enableTranslationPrewarm: event.currentTarget.checked
                  })
                }
              />
            </label>

            <label style={labelStyle}>
              <span>
                <strong>手动预热释义范围</strong>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  点击面板里的“预热释义”时使用。
                </div>
              </span>
              <select
                value={settings.manualTranslationPrewarmScope}
                onChange={(event) =>
                  updateSettings({
                    manualTranslationPrewarmScope: event.currentTarget
                      .value as LearningSettings["manualTranslationPrewarmScope"]
                  })
                }
                style={{ width: 150, padding: "6px 8px" }}>
                <option value="next20m">后续 20 分钟</option>
                <option value="remaining">本视频剩余全部</option>
              </select>
            </label>

            <label style={labelStyle}>
              <span>
                <strong>手动预热释义数量</strong>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  点击面板里的“预热释义”时，最多处理多少个唯一单词。
                </div>
              </span>
              <select
                value={settings.manualTranslationPrewarmWordLimit}
                onChange={(event) =>
                  updateSettings({
                    manualTranslationPrewarmWordLimit: Number(
                      event.currentTarget.value
                    ) as LearningSettings["manualTranslationPrewarmWordLimit"]
                  })
                }
                style={{ width: 150, padding: "6px 8px" }}>
                <option value={720}>720 个</option>
                <option value={1440}>1440 个</option>
                <option value={2160}>2160 个</option>
                <option value={2880}>2880 个</option>
              </select>
            </label>

            <label
              style={{
                ...labelStyle,
                borderBottom: "none"
              }}>
              <span>
                <strong>字幕提前量</strong>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  用来抵消 YouTube 自动字幕比讲话稍晚的问题。
                </div>
              </span>
              <input
                type="number"
                min={0}
                max={3}
                step={0.05}
                value={settings.captionLeadSeconds}
                onChange={(event) =>
                  updateSettings({
                    captionLeadSeconds: Number(event.currentTarget.value)
                  })
                }
                style={{ width: 90, padding: "6px 8px" }}
              />
            </label>
          </>
        )}
      </section>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button type="button" onClick={() => void save()} style={buttonStyle}>
          保存设置
        </button>
        <button
          type="button"
          onClick={() => void clearCache()}
          style={{ ...buttonStyle, background: "#fff", color: "#0f172a" }}>
          清空翻译缓存
        </button>
      </div>

      {status && (
        <div
          style={{
            marginTop: 14,
            color: status.includes("失败") ? "#b91c1c" : "#334155"
          }}>
          {status}
        </div>
      )}
    </main>
  )
}

export default SettingsTab
