import React, { useEffect, useState } from 'react';
import classnames from 'classnames';

import './ViewportOverlay.css';

// The overlay-top and overlay-bottom classes are explicitly needed to offset
// the overlays (i.e. via absolute positioning) such the ViewportActionCorners
// have space for its child components.
// ToDo: offset the ViewportOverlay automatically via css to account for the
// space needed for ViewportActionCorners.
const classes = {
  topLeft: 'overlay-top left-viewport',
  topRight: 'overlay-top right-viewport-scrollbar',
  bottomRight: 'overlay-bottom right-viewport-scrollbar',
  bottomLeft: 'overlay-bottom left-viewport',
};

export type ViewportOverlayProps = {
  topLeft: React.ReactNode;
  topRight: React.ReactNode;
  bottomRight: React.ReactNode;
  bottomLeft: React.ReactNode;
  color?: string;
  servicesManager: AppTypes.ServicesManager
};

const ViewportOverlay = ({
  topLeft,
  topRight,
  bottomRight,
  bottomLeft,
  color = 'text-primary-active',
  servicesManager
}: ViewportOverlayProps) => {
  const { viewportOverlayService } = servicesManager.services
  const [ show, setShow ] = useState(viewportOverlayService.getShow())

  const overlay = 'absolute pointer-events-none viewport-overlay';

  useEffect(() => {
    console.log('ViewportOverlay useEffect')
    const updateShow = () => {
      setShow(viewportOverlayService.getShow())
    }

    const { unsubscribe } = viewportOverlayService.subscribe(
      viewportOverlayService.EVENTS.STATE_CHANGE,
      updateShow
    )

    return () => {
      unsubscribe()
    }
  }, [])

  return (
    <div
      className={classnames(
        color ? color : 'text-aqua-pale',
        'text-[13px]',
        'leading-5',
        'overlay-text'
      )}
    >
      <div
        data-cy={'viewport-overlay-top-left'}
        className={classnames(overlay, classes.topLeft)}
      >
        {show && topLeft}
      </div>
      <div
        data-cy={'viewport-overlay-top-right'}
        className={classnames(overlay, classes.topRight)}
        style={{ transform: 'translateX(-8px)' }} // shift right side overlays by 4px for better alignment with ViewportActionCorners' icons
      >
        {show && topRight}
      </div>
      <div
        data-cy={'viewport-overlay-bottom-right'}
        className={classnames(overlay, classes.bottomRight)}
        style={{ transform: 'translateX(-8px)' }} // shift right side overlays by 4px for better alignment with ViewportActionCorners' icons
      >
        {show && bottomRight}
      </div>
      <div
        data-cy={'viewport-overlay-bottom-left'}
        className={classnames(overlay, classes.bottomLeft)}
      >
        {show && bottomLeft}
      </div>
    </div>
  );
};

export default ViewportOverlay;
