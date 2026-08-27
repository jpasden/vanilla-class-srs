import { ReactNode, useEffect } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /**
   * When true, disables backdrop-click and Escape dismissal — only an
   * explicit action inside the modal (e.g. a "Done" button) can close it.
   * Use for one-time, unrecoverable information (e.g. a temp password shown
   * only once) where an accidental dismissal would lose it for good.
   */
  preventDismiss?: boolean
}

export function Modal({ title, onClose, children, footer, preventDismiss = false }: Props) {
  useEffect(() => {
    if (preventDismiss) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, preventDismiss])

  return (
    <div className="modal-overlay" onClick={(e) => { if (!preventDismiss && e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ marginBottom: 0 }}>{title}</h2>
          {!preventDismiss && <button onClick={onClose} className="btn btn-secondary btn-sm">✕</button>}
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
