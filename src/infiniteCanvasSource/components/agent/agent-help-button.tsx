import { useState } from 'react';
import { Button, Modal, Tooltip } from 'antd';
import { Download, CircleHelp } from 'lucide-react';

export function AgentHelpButton() {
    const [open, setOpen] = useState(false);
    return <>
        <Tooltip title="连接教程" placement="bottom">
            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" aria-label="Canvas Agent 连接教程" icon={<CircleHelp size={16} />} onClick={() => setOpen(true)} />
        </Tooltip>
        <Modal title="连接 Canvas Agent" open={open} onCancel={() => setOpen(false)} footer={null} width={540}>
            <div className="space-y-5 py-2 text-sm leading-6">
                <ol className="list-decimal space-y-3 pl-5">
                    <li>首次使用先安装 <a className="text-blue-600 underline" href="https://nodejs.org/zh-cn/download" target="_blank" rel="noreferrer">Node.js 22 或更新的 LTS 版本</a>。</li>
                    <li>下载 Windows 启动包，解压后双击 <strong>启动画布助手.cmd</strong>，等待准备完成。若提示未登录，双击同目录的 <strong>登录Codex.cmd</strong> 完成登录。</li>
                    <li>启动成功后，回到本页，将窗口显示的服务地址填入“服务地址”，将已复制的令牌粘贴到“连接令牌”，点击“连接”。复制失败时可从窗口手动复制。</li>
                </ol>
                <Button type="primary" icon={<Download size={16} />} href="/downloads/wenyun-canvas-agent.zip" download="wenyun-canvas-agent.zip">下载 Windows 启动包</Button>
                <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-white/10">
                    <p>默认服务地址：<code className="break-all">http://127.0.0.1:17371</code>。这里填写本机 Agent 的连接令牌，不是生图 API Key，也不是中转站地址。</p>
                    <p>使用期间保持启动窗口打开。下次双击同一个文件即可启动，无需重复安装。</p>
                    <p>网站部署在服务器也连接你自己的电脑。每人使用自己的 Codex 登录和令牌；同一电脑共用同一服务时，会共用会话。</p>
                    <p>若浏览器询问本地网络访问权限，请允许当前站点访问。手机需使用电脑上的画布助手。</p>
                </div>
            </div>
        </Modal>
    </>;
}
