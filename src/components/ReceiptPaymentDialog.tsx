import { useEffect, useRef, useState } from 'react'
import { QRCode } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestNewApiReceiptOrder, type NewApiReceiptOrder } from '../lib/newApiAccount'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { CloseIcon } from './icons'

interface Props {
  profile: ApiProfile
  session: NewApiAccountSession
  initialOrder: NewApiReceiptOrder
  onSessionUpdated: (session: NewApiAccountSession) => void
  onPaid: () => void | Promise<void>
  onClose: () => void
}

export default function ReceiptPaymentDialog({ profile, session, initialOrder, onSessionUpdated, onPaid, onClose }: Props) {
  const client = useQueryClient()
  const [now, setNow] = useState(() => performance.now())
  const [confirmClose, setConfirmClose] = useState(false)
  const notified = useRef(false)
  const onPaidRef = useRef(onPaid)
  onPaidRef.current = onPaid
  // 缓存按站点、账号和订单隔离，切换账号不能显示上一位用户的收款信息。
  const queryKey = ['wenyun-receipt', profile.baseUrl, session.userId, session.authSessionId, initialOrder.trade_no]
  const query = useQuery({
    queryKey,
    queryFn: () => requestNewApiReceiptOrder(profile, session, initialOrder.trade_no, undefined, onSessionUpdated),
    initialData: initialOrder,
    retry: false,
    refetchInterval: (state) => state.state.data?.status === 'pending' ? 10000 : false,
  })
  const action = useMutation({
    mutationFn: (value: 'confirm' | 'close') => requestNewApiReceiptOrder(profile, session, initialOrder.trade_no, value, onSessionUpdated),
    retry: false,
    onMutate: async () => { await client.cancelQueries({ queryKey }) },
    onSuccess: (order) => { client.setQueryData(queryKey, order); setConfirmClose(false) },
  })
  const order = query.data
  const clock = order.serverClock
  // 使用服务端时间加单调计时，不受客户电脑时间或运行中调整系统时间影响。
  const serverNow = clock ? clock.timestamp + Math.max(0, Math.max(now, performance.now()) - clock.receivedAt) : undefined
  const secondsLeft = serverNow === undefined ? 0 : Math.max(0, Math.ceil((order.receipt.expires_at * 1000 - serverNow) / 1000))
  const payable = !!clock && order.status === 'pending' && order.paid_time === 0 && secondsLeft > 0
  useEffect(() => {
    // 查询失败仍按上次的服务器时钟继续倒计时，不重新发放付款时间。
    const update = () => setNow(performance.now())
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  useEffect(() => {
    // 只认服务器入账成功，不把用户确认金额或展示二维码当作付款成功。
    if (order.status === 'success' && !notified.current) {
      notified.current = true
      void onPaidRef.current()
    }
  }, [order.status])
  const button = 'rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15'
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { event.stopPropagation() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="receipt-payment-title" className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 text-gray-900 shadow-xl dark:bg-gray-950 dark:text-gray-100">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="receipt-payment-title" className="font-semibold">支付宝收款码</h3>
          <button type="button" onClick={onClose} aria-label="关闭付款窗口" className="p-1"><CloseIcon className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 text-center">
          <p className="break-all text-xs text-gray-500">{order.trade_no}</p>
          <p className="text-3xl font-semibold tabular-nums">¥{(order.receipt.amount_cents / 100).toFixed(2)}</p>
          {order.status === 'success' && <p className="text-green-600">支付已到账</p>}
          {order.status === 'closed' && <p>订单已关闭</p>}
          {order.status === 'expired' && <p>订单已过期</p>}
          {order.status === 'pending' && order.paid_time > 0 && <p>已收到付款，正在入账</p>}
          {order.status === 'pending' && !order.paid_time && !clock && <p>暂时无法校验付款时间，请刷新状态。</p>}
          {order.status === 'pending' && !order.paid_time && clock && !payable && <p>付款时间已结束，请勿继续付款。</p>}
          {payable && <>
            <p className="text-sm">请按显示金额付款，包括小数部分。</p>
            <p role="timer" className="tabular-nums">剩余付款时间 {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</p>
            {order.receipt.qr_code && order.receipt.confirmed_at > 0 ? (
              <div className="mx-auto w-fit rounded-xl bg-white p-3" style={{ colorScheme: 'light', forcedColorAdjust: 'none' }}>
                <QRCode type="canvas" value={order.receipt.qr_code} size={220} marginSize={4} color="#000000" bgColor="#ffffff" bordered={false} aria-label="支付宝付款二维码" />
              </div>
            ) : <button type="button" disabled={action.isPending} onClick={() => action.mutate('confirm')} className="rounded-xl bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50">确认金额并显示收款码</button>}
          </>}
          {(query.error || action.error) && <p role="alert" className="text-sm text-red-500">{(action.error || query.error)?.message}</p>}
          {confirmClose && <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm dark:bg-white/5">
            <p>关闭后请勿付款。关闭订单不会退回已支付的款项。</p>
            <button type="button" disabled={action.isPending} onClick={() => action.mutate('close')} className={button}>确认关闭订单</button>
            <button type="button" onClick={() => setConfirmClose(false)} className="ml-2 text-blue-500">返回</button>
          </div>}
          <div className="flex justify-center gap-2">
            {order.status === 'pending' && !order.paid_time && <button type="button" disabled={action.isPending} onClick={() => setConfirmClose(true)} className={button}>关闭订单</button>}
            <button type="button" disabled={query.isFetching || action.isPending} onClick={() => void query.refetch()} className={button}>刷新状态</button>
            <button type="button" onClick={onClose} className={button}>关闭</button>
          </div>
        </div>
      </section>
    </div>
  )
}
