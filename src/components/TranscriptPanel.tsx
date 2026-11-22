import React from 'react';
import { AudioLines, FileText, Plus, Upload, X } from 'lucide-react';
import type { Asset, Clip, EditOperation, Sequence } from '../core/types';
import { newClip, timecode, transcriptToCaptionClips } from '../core/project';
import { IconButton } from './ui';

export interface TranscriptPanelProps {
  sequence: Sequence;
  sequenceId: string;
  frame: number;
  selectedClip: Clip | undefined;
  transcribedAssets: Asset[];
  scriptQuery: string;
  onScriptQueryChange: (next: string) => void;
  onImportSrt: () => void;
  onTranscribe: (assetId?: string) => void;
  onExportSrt: () => void;
  onAddCaption: () => void;
  onSeek: (frame: number) => void;
  onSelectClip: (clipId: string) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
}

export function TranscriptPanel({
  sequence,
  sequenceId,
  frame,
  selectedClip,
  transcribedAssets,
  scriptQuery,
  onScriptQueryChange,
  onImportSrt,
  onTranscribe,
  onExportSrt,
  onAddCaption,
  onSeek,
  onSelectClip,
  onEdit,
}: TranscriptPanelProps) {
  const captionCount = sequence.clips.filter((c) => c.kind === 'caption').length;
  const q = scriptQuery.trim().toLowerCase();

  return (
    <div className="transcript-panel">
      <div className="sub-toolbar">
        <span>
          {captionCount} 条字幕
          {transcribedAssets.length > 0 ? ` · ${transcribedAssets.length} 份已缓存源文稿` : ''} ·
          点击时间跳转，编辑文字后自动保存
        </span>
        <input
          className="script-search-input"
          aria-label="检索文稿与字幕"
          placeholder="搜索词句…"
          value={scriptQuery}
          onChange={(e) => onScriptQueryChange(e.target.value)}
        />
        <button className="button tiny" onClick={onImportSrt}>
          <Upload size={12} /> 导入 SRT
        </button>
        <button className="button tiny" onClick={() => onTranscribe(selectedClip?.assetId)}>
          <AudioLines size={12} />
          转录素材
        </button>
        <button className="button tiny" onClick={onExportSrt}>
          导出 SRT
        </button>
      </div>

      {transcribedAssets.map((a) => {
        const matchedSegs = (a.transcript?.segments || []).filter(
          (seg) => !q || seg.text.toLowerCase().includes(q),
        );
        return (
          <details className="source-transcript-card" key={a.id} open={Boolean(q)}>
            <summary>
              <AudioLines size={13} />
              <b>源素材转录：{a.name}</b>
              <small>{a.transcript?.segments.length || 0} 个时间段</small>
              <button
                type="button"
                className="button tiny"
                style={{ marginLeft: 'auto' }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const caps = transcriptToCaptionClips(sequence, a);
                  if (!caps.length) return;
                  onEdit(
                    `由「${a.name}」转录生成字幕`,
                    caps.map((c) => ({ type: 'addClip', sequenceId, clip: c })),
                  );
                }}
              >
                + 铺入时间线字幕
              </button>
            </summary>
            {matchedSegs.length > 0 ? (
              <div className="transcript-segments-list">
                {matchedSegs.map((seg, idx) => (
                  <div className="transcript-seg-row" key={idx}>
                    <span>{seg.start.toFixed(1)}s</span>
                    <p>{seg.text}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        const fps = sequence.fps;
                        const srcIn = Math.max(0, Math.floor(seg.start * fps));
                        const dur = Math.max(8, Math.round((seg.end - seg.start) * fps));
                        const tail = Math.max(
                          frame,
                          ...sequence.clips
                            .filter((x) => x.track === (a.kind === 'audio' ? 'audio' : 'visual'))
                            .map((x) => x.start + x.duration),
                          0,
                        );
                        const mediaClip = {
                          ...newClip(a.kind === 'audio' ? 'audio' : 'video', tail, a.id),
                          name: seg.text.slice(0, 18) || a.name,
                          sourceIn: srcIn,
                          duration: dur,
                        };
                        const capClip = {
                          ...newClip('caption', tail),
                          name: seg.text.slice(0, 18) || '字幕',
                          duration: dur,
                          props: {
                            text: seg.text,
                            fontSize: 44,
                            color: '#ffffff',
                            position: 'bottom' as const,
                            background: '#00000085',
                            animation: 'none' as const,
                          },
                        };
                        onEdit('插入文稿切片', [
                          { type: 'addClip', sequenceId, clip: mediaClip },
                          { type: 'addClip', sequenceId, clip: capClip },
                        ]);
                      }}
                    >
                      + 切片入轨
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p>{a.transcript?.text}</p>
            )}
          </details>
        );
      })}

      {sequence.clips
        .filter((c) => c.kind === 'caption' && (!q || String(c.props.text || '').toLowerCase().includes(q)))
        .sort((a, b) => a.start - b.start)
        .map((c) => (
          <div
            className={`transcript-row ${frame >= c.start && frame < c.start + c.duration ? 'current' : ''}`}
            key={c.id}
          >
            <button
              onClick={() => {
                onSeek(c.start);
                onSelectClip(c.id);
              }}
            >
              {timecode(c.start, sequence.fps)}
            </button>
            <input
              aria-label={`字幕 ${c.name}`}
              defaultValue={String(c.props.text || '')}
              disabled={c.locked}
              onBlur={(e) => {
                if (e.target.value !== c.props.text) {
                  onEdit('修改字幕', [
                    {
                      type: 'updateClip',
                      sequenceId,
                      clipId: c.id,
                      changes: { props: { text: e.target.value } },
                    },
                  ]);
                }
              }}
            />
            <IconButton
              label={`删除字幕 ${c.name}`}
              disabled={c.locked}
              onClick={() => onEdit('删除字幕', [{ type: 'deleteClip', sequenceId, clipId: c.id }])}
            >
              <X size={12} />
            </IconButton>
          </div>
        ))}

      {captionCount === 0 && transcribedAssets.length === 0 && (
        <div className="panel-empty">
          <FileText size={23} />
          <p>把对白与画面连接起来。</p>
          <span>导入 SRT 字幕，或对音视频素材发起转录。</span>
          <button className="button tiny" onClick={onAddCaption}>
            <Plus size={12} /> 添加字幕
          </button>
        </div>
      )}
    </div>
  );
}
