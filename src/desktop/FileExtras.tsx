import { useEffect, useMemo, useRef, useState } from 'react'
import { api, reportError, setPreview } from './client'
import type { FolderMapData, Preview } from './types'
import { showMap, squarify, useGitStatus } from './fileInsights'
import DiffView from '../components/DiffView'

export { DiffView }

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`

// A folder's entries sized by bytes. Click a folder to map it, a file to preview it.
export function FolderMap({ map }: { map: FolderMapData }) {
  const ref = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setArea({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const git = useGitStatus(map.path, 0, true)
  const boxes = useMemo(() => squarify(map.children.slice(0, 200), area.width, area.height), [map.children, area])
  const open = (item: FolderMapData['children'][number]) => item.directory ? showMap(item.path) : api<Preview>(`/preview?path=${encodeURIComponent(item.path)}`).then(setPreview).catch(reportError)
  return <div className="folder-map">
    <div className="folder-map-bar"><button className="desk-secondary" onClick={() => showMap(map.parent)}>Map the parent folder</button><span>{size(map.size)} in {map.children.length} entries{map.complete ? '' : ' · large folder, partly measured'}</span><span className="folder-map-legend"><i className="changed" />changed in Git</span></div>
    <div className="folder-map-area" ref={ref}>{boxes.map(({ item, x, y, w, h }) => {
      const changed = item.directory ? git.changedFolder(item.path) : !!git.lookup(item.path)
      return <button key={item.path} className={`folder-map-box ${item.directory ? 'directory' : ''} ${changed ? 'changed' : ''}`} style={{ left: x, top: y, width: w, height: h }} title={`${item.name} · ${size(item.size)}${item.directory ? ` · ${item.files} files` : ''}`} onClick={() => void open(item)}>
        {w > 46 && h > 26 && <><strong>{item.name}</strong><small>{size(item.size)}</small></>}
      </button>
    })}{!boxes.length && <p className="file-tree-note">This folder holds no files.</p>}</div>
  </div>
}
