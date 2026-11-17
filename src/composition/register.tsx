import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Film, FilmProps } from './Film';
import { newProject, durationOf } from '../core/project';
const p = newProject('Empty');
const defaults: FilmProps = { project: p, sequenceId: p.sequences[0].id, mediaOrigin: '' };
const Root = () => (
  <Composition
    id="CoCraft"
    component={Film}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30}
    defaultProps={defaults}
    calculateMetadata={({ props }) => {
      const s = props.project.sequences.find((s) => s.id === props.sequenceId) || props.project.sequences[0];
      return { width: s.width, height: s.height, fps: s.fps, durationInFrames: durationOf(s) };
    }}
  />
);
registerRoot(Root);
