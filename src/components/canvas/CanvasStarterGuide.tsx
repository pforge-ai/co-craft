import React from 'react';
import {
  ArrowRight,
  Box,
  CheckCircle2,
  Code2,
  FileText,
  KeyRound,
  Upload,
  UserCheck,
} from 'lucide-react';
import type { Settings } from '../../core/types';

interface CanvasStarterGuideProps {
  settings?: Settings;
  onStartSpatialDirector: () => void;
  onCreateScriptNode: () => void;
  onStartCodeMotion: () => void;
  onImportAndEdit: () => void;
  onCreateSubject: () => void;
  onOpenQuickSetup?: () => void;
}

export function CanvasStarterGuide({
  settings,
  onStartSpatialDirector,
  onCreateScriptNode,
  onStartCodeMotion,
  onImportAndEdit,
  onCreateSubject,
  onOpenQuickSetup,
}: CanvasStarterGuideProps) {
  const cloudProviders = (settings?.providers || []).filter(
    (p) => p.protocol !== 'system' && (p.hasApiKey || p.apiKey || !p.requiresKey),
  );
  const cloudModels = (settings?.models || []).filter((m) => m.adapter !== 'system-speech');
  const hasCloudReady = cloudProviders.length > 0 && cloudModels.length > 0;
  const readyAgent = cloudModels.some((m) => m.capabilities.includes('agent'));
  const readyMedia = cloudModels.some(
    (m) => m.capabilities.includes('image') || m.capabilities.includes('video'),
  );

  return (
    <div className="cc-empty-hero cc-starter-v06" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cc-starter-eyebrow">3 分钟出首片 · 选一条主线直接开始</div>
      <h2>从 3D 导演控镜、脚本拆镜或可编程视觉起步</h2>
      <p>
        未配置云端模型也可零费用使用 3D 导演棚、2.5D 升维、矢量动效与多轨精剪；接入一家模型即可打通全模态生片。
      </p>

      {onOpenQuickSetup && (
        <div className={`cc-engine-banner ${hasCloudReady ? 'ready' : 'setup'}`}>
          <div className="cc-engine-banner-copy">
            {hasCloudReady ? (
              <>
                <CheckCircle2 size={14} />
                <span>
                  AI 引擎就绪 · 已连 {cloudProviders.length} 家提供商 / {cloudModels.length} 个模型
                  {readyAgent && readyMedia ? '（对话编排 + 生图视频全通）' : readyAgent ? '（已配编排大脑）' : ''}
                </span>
              </>
            ) : (
              <>
                <KeyRound size={14} />
                <span>
                  尚未接入云端 AI 模型 · <strong>1 分钟一键配齐</strong>（阿里百炼 / 火山方舟 / MiniMax / DeepSeek / OpenAI）
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className={`cc-engine-banner-btn ${hasCloudReady ? 'subtle' : 'primary'}`}
            onClick={onOpenQuickSetup}
          >
            {hasCloudReady ? '管理模型' : '1 分钟快速配置'}
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      <div className="cc-starter-grid cc-starter-grid-4">
        <button
          type="button"
          className="cc-starter-card featured"
          onClick={onStartSpatialDirector}
        >
          <div className="cc-starter-head">
            <Box size={15} />
            <span className="cc-starter-pill">王牌 · ¥0 预演</span>
          </div>
          <b>3D 导演棚 → AI 控镜短片</b>
          <small>摆好布景、人物走线与多机位，录真 MP4 或首尾帧直连 AI 重绘</small>
        </button>

        <button type="button" className="cc-starter-card" onClick={onCreateScriptNode}>
          <div className="cc-starter-head">
            <FileText size={15} />
            <span className="cc-starter-step">T</span>
          </div>
          <b>文稿拆镜 · L1 零视频费大片</b>
          <small>写几行剧本自动拆成镜头序列，叠 2.5D 视差、呼吸运镜与高亮字幕</small>
        </button>

        <button type="button" className="cc-starter-card" onClick={onStartCodeMotion}>
          <div className="cc-starter-head">
            <Code2 size={15} />
            <span className="cc-starter-step">A</span>
          </div>
          <b>可编程科普 / 动态图解</b>
          <small>用数据流、手绘白板与代码组件生成矢量超清、逐帧可控的解说镜头</small>
        </button>

        <button type="button" className="cc-starter-card" onClick={onImportAndEdit}>
          <div className="cc-starter-head">
            <Upload size={15} />
            <span className="cc-starter-step">U</span>
          </div>
          <b>导入实拍 / 录屏精剪</b>
          <small>直接导入视频、音频或 3D 模型，进入多轨时间线与贝塞尔关键帧精修</small>
        </button>
      </div>

      <div className="cc-starter-foot-links">
        <button type="button" className="cc-starter-link" onClick={onCreateSubject}>
          <UserCheck size={12} /> 或先建立角色 / 产品一致性设定卡
        </button>
        <span className="cc-starter-dot">·</span>
        <span>双击空白处速建文本节点 · 拖入任意媒体即刻上画布</span>
      </div>
    </div>
  );
}
