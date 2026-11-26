import { useCallback, useState } from 'react';
import type { GenerationDraft } from '../components/GenerationDialog';
import type { SpatialDirectorTarget } from '../components/SpatialDirectorStudio';
import type { CodeComponent, Job } from '../core/types';

export type WorkbenchDialog =
  | 'settings'
  | 'export'
  | 'new-project'
  | 'new-task'
  | 'command'
  | 'versions'
  | 'templates'
  | 'code'
  | 'stock'
  | 'generation'
  | 'job-result'
  | 'rename-task'
  | 'sequence'
  | null;

export function useWorkbenchDialogs() {
  const [dialog, setDialog] = useState<WorkbenchDialog>(null);
  const [spatialStudio, setSpatialStudio] = useState<SpatialDirectorTarget | null>(null);
  const [formName, setFormName] = useState('');
  const [command, setCommand] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  const [codeComponent, setCodeComponent] = useState<CodeComponent | undefined>();
  const [generationDraft, setGenerationDraft] = useState<GenerationDraft>({ use: 'image' });
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [returnToStudio, setReturnToStudio] = useState(false);
  const [resultJob, setResultJob] = useState<Job | undefined>();
  const [resultClip, setResultClip] = useState('');
  const [seqFormat, setSeqFormat] = useState('9:16');

  const openSettings = useCallback((tab?: string, fromStudio = false) => {
    setSettingsTab(tab);
    setReturnToStudio(fromStudio);
    setDialog('settings');
  }, []);

  const openStudio = useCallback(
    (useOrDraft: GenerationDraft['use'] | GenerationDraft = 'image', assetId?: string) => {
      if (typeof useOrDraft === 'string') {
        setGenerationDraft({ use: useOrDraft, assetId });
      } else {
        setGenerationDraft(useOrDraft);
      }
      setDialog('generation');
    },
    [],
  );

  return {
    dialog,
    setDialog,
    spatialStudio,
    setSpatialStudio,
    formName,
    setFormName,
    command,
    setCommand,
    cmdIndex,
    setCmdIndex,
    codeComponent,
    setCodeComponent,
    generationDraft,
    setGenerationDraft,
    settingsTab,
    setSettingsTab,
    returnToStudio,
    setReturnToStudio,
    resultJob,
    setResultJob,
    resultClip,
    setResultClip,
    seqFormat,
    setSeqFormat,
    openSettings,
    openStudio,
  };
}
