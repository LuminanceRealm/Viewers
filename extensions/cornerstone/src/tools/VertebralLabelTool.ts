import { LabelTool, annotation as csAnnotation, drawing } from '@cornerstonejs/tools';

const { drawCircle: drawCircleSvg } = drawing;
const { getAnnotations } = csAnnotation.state;

/**
 * Full craniocaudal spine sequence. Index order matters: moving "down" (caudal)
 * advances the index, moving "up" (cranial) decreases it.
 */
export const SPINE_LABELS = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
  'T11',
  'T12',
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
];

export const DEFAULT_START_LABEL = 'L5';

/**
 * Vertebral counting tool.
 *
 * Behaves like the cornerstone LabelTool (a point plus a text box) but instead
 * of asking for free text on every click it walks the spine sequence: the first
 * click asks for the starting vertebra and the counting direction, and each
 * following click drops the next label automatically. Reaching either end of
 * the sequence re-opens the picker.
 *
 * The sequence is anchored again every time the tool is (re)activated, so
 * picking the tool from the toolbar always starts a fresh count.
 */
class VertebralLabelTool extends LabelTool {
  static toolName = 'VertebralLabel';

  // index of the label the *next* click will place; null means "ask first"
  _nextIndex: number | null = null;
  // +1 counts caudally (down), -1 counts cranially (up)
  _step: 1 | -1 = -1;

  _labelToolRenderAnnotation = this.renderAnnotation;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
        // point marker radius in canvas pixels
        markerRadius: 3,
        /**
         * Injected by the mode's tool group configuration. Receives a callback
         * that must be called with `{ startLabel, direction }`, or with a falsy
         * value when the user cancels.
         */
        promptStartCallback: null,
        /**
         * Injected by the mode's tool group configuration. Receives the current
         * text and a callback to be called with the edited text.
         */
        promptEditCallback: null,
      },
    }
  ) {
    super(toolProps, defaultToolProps);

    // Take over the LabelTool text hooks: labels come from the sequence, not
    // from a free-text prompt.
    this.configuration.getTextCallback = this._getNextLabel;
    this.configuration.changeTextCallback = this._changeLabel;
  }

  onSetToolActive() {
    this.resetSequence();
  }

  onSetToolPassive() {
    this.resetSequence();
  }

  onSetToolDisabled() {
    this.resetSequence();
  }

  resetSequence() {
    this._nextIndex = null;
  }

  /**
   * Anchors the sequence on `label`, so the next click continues from it.
   */
  _anchorSequence(label: string, direction?: 'up' | 'down') {
    if (direction) {
      this._step = direction === 'up' ? -1 : 1;
    }

    const index = SPINE_LABELS.indexOf(label);
    this._nextIndex = index === -1 ? null : index + this._step;
  }

  _getNextLabel = (doneChangingTextCallback: (text: string | null) => void) => {
    const { promptStartCallback } = this.configuration;

    // Either the very first click, or the sequence ran off one of its ends.
    if (
      this._nextIndex === null ||
      this._nextIndex < 0 ||
      this._nextIndex >= SPINE_LABELS.length
    ) {
      this._nextIndex = null;

      if (typeof promptStartCallback !== 'function') {
        // No picker wired up: fall back to the default start going cranially.
        this._anchorSequence(DEFAULT_START_LABEL, 'up');
        doneChangingTextCallback(DEFAULT_START_LABEL);
        return;
      }

      promptStartCallback(result => {
        if (!result || !result.startLabel) {
          doneChangingTextCallback(null);
          return;
        }

        this._anchorSequence(result.startLabel, result.direction);
        doneChangingTextCallback(result.startLabel);
      });

      return;
    }

    const label = SPINE_LABELS[this._nextIndex];
    this._nextIndex += this._step;
    doneChangingTextCallback(label);
  };

  _changeLabel = (data, eventDetails, doneChangingTextCallback: (text: string) => void) => {
    const { promptEditCallback } = this.configuration;
    const currentText = data?.text ?? '';

    if (typeof promptEditCallback !== 'function') {
      doneChangingTextCallback(currentText);
      return;
    }

    promptEditCallback(currentText, text => {
      if (!text) {
        return;
      }

      // Correcting a label re-anchors the count so the following clicks follow
      // from the corrected vertebra.
      this._anchorSequence(text);
      doneChangingTextCallback(text);
    });
  };

  /**
   * The LabelTool only draws the text box; a vertebral count also needs the
   * point itself so the reader can see which vertebra each label refers to.
   */
  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const renderStatus = this._labelToolRenderAnnotation(enabledElement, svgDrawingHelper);

    const { viewport } = enabledElement;
    const { element } = viewport;

    let annotations = getAnnotations(this.getToolName(), element);

    if (!annotations?.length) {
      return renderStatus;
    }

    annotations = this.filterInteractableAnnotationsForElement(element, annotations);

    const styleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: viewport.id,
      annotationUID: undefined,
    };

    annotations.forEach(annotation => {
      const { annotationUID, data } = annotation;

      if (!data?.text) {
        return;
      }

      styleSpecifier.annotationUID = annotationUID;

      const color = this.getStyle('color', styleSpecifier, annotation);
      const canvasCoordinates = viewport.worldToCanvas(data.handles.points[0]);

      drawCircleSvg(
        svgDrawingHelper,
        annotationUID,
        'vertebral-point',
        canvasCoordinates,
        this.configuration.markerRadius,
        { color, fill: color }
      );
    });

    return renderStatus;
  };
}

export default VertebralLabelTool;
