type ToastProps = {
  message: string
}

export const Toast = ({ message }: ToastProps) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        right: 12,
        background: "rgba(17, 24, 39, 0.94)",
        color: "#fff",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12
      }}>
      {message}
    </div>
  )
}

