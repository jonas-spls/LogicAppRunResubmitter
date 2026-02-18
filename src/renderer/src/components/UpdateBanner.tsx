import { useEffect, useState } from 'react'

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseName: string
}

export default function UpdateBanner(): JSX.Element | null {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api.checkForUpdates().then((info) => {
      if (info) setUpdate(info)
    })
  }, [])

  if (!update || dismissed) return null

  return (
    <div className="update-banner">
      <span>
        <strong>v{update.latestVersion}</strong> is available
        <span className="update-banner-current">(you have v{update.currentVersion})</span>
      </span>
      <div className="update-banner-actions">
        <button
          className="update-banner-download"
          onClick={() => window.api.openExternal(update.releaseUrl)}
        >
          Download
        </button>
        <button className="update-banner-dismiss" onClick={() => setDismissed(true)}>
          ✕
        </button>
      </div>
    </div>
  )
}
