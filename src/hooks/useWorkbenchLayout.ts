import { useEffect, useRef, useState } from 'react';
import type { AssetCategory } from '../components/AssetExplorer';

export function useWorkbenchLayout() {
  const [appMode, setAppMode] = useState<'create' | 'edit'>('create');
  const [showBrief, setShowBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState('');
  const [showStageFork, setShowStageFork] = useState(false);
  const [stageForkName, setStageForkName] = useState('');
  const [stageForkAspect, setStageForkAspect] = useState<'original' | 'portrait' | 'square'>('original');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [view, setView] = useState('timeline');
  const [right, setRight] = useState('inspector');
  const [showNav, setShowNav] = useState(false);
  const [showBottom, setShowBottom] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobsScope, setJobsScope] = useState<'project' | 'all'>('project');
  const [assetCategory, setAssetCategory] = useState<AssetCategory>('media');
  const [draggingFile, setDraggingFile] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(
    () => Number(localStorage.getItem('cc-timeline-height')) || 278,
  );
  const [agentWidth, setAgentWidth] = useState(
    () => Number(localStorage.getItem('cc-agent-width')) || 316,
  );
  const [navWidth, setNavWidth] = useState(
    () => Number(localStorage.getItem('cc-nav-width')) || 240,
  );

  const savedPanesRef = useRef({ nav: true, right: true, bottom: true });

  useEffect(() => {
    const reset = () => {
      setNavWidth(240);
      setAgentWidth(350);
      setTimelineHeight(278);
    };
    window.addEventListener('cocraft:reset-layout', reset);
    return () => window.removeEventListener('cocraft:reset-layout', reset);
  }, []);

  return {
    appMode,
    setAppMode,
    showBrief,
    setShowBrief,
    briefDraft,
    setBriefDraft,
    showStageFork,
    setShowStageFork,
    stageForkName,
    setStageForkName,
    stageForkAspect,
    setStageForkAspect,
    projectMenuOpen,
    setProjectMenuOpen,
    layoutMenuOpen,
    setLayoutMenuOpen,
    view,
    setView,
    right,
    setRight,
    showNav,
    setShowNav,
    showBottom,
    setShowBottom,
    showRight,
    setShowRight,
    jobsOpen,
    setJobsOpen,
    jobsScope,
    setJobsScope,
    assetCategory,
    setAssetCategory,
    draggingFile,
    setDraggingFile,
    timelineHeight,
    setTimelineHeight,
    agentWidth,
    setAgentWidth,
    navWidth,
    setNavWidth,
    savedPanesRef,
  };
}
