import Header from './Header'
import SearchBar from './SearchBar'
import TaskGrid from './TaskGrid'
import InputBar from './InputBar'
import DetailModal from './DetailModal'
import ImageContextMenu from './ImageContextMenu'
import './wenyun-mobile.css'

// 文运工坊作为独立入口按需加载，主页不提前下载生成面板和历史列表。
export default function WenyunWorkshop({ onOpenHome, onOpenCanvas }: {
  onOpenHome: () => void
  onOpenCanvas: () => void
}) {
  return (
    <>
      <Header onOpenHome={onOpenHome} onOpenCanvas={onOpenCanvas} />
      <main data-home-main data-drag-select-surface className="pb-[calc(var(--input-bar-clearance,12rem)+1rem)]">
        <div className="safe-area-x max-w-7xl mx-auto">
          <SearchBar />
          <TaskGrid />
        </div>
      </main>
      <InputBar />
      <DetailModal />
      <ImageContextMenu />
    </>
  )
}
