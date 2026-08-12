import React from 'react';
import { FooterAction } from '@ohif/ui-next';

type PrintConfirmDialogProps = {
  message: string;
  hide: () => void;
  onConfirm: () => void;
};

export default function PrintConfirmDialog({ message, hide, onConfirm }: PrintConfirmDialogProps) {
  return (
    <div className="text-foreground">
      <p className="text-base">{message}</p>
      <FooterAction className="mt-4">
        <FooterAction.Right>
          <FooterAction.Secondary onClick={hide}>Cancelar</FooterAction.Secondary>
          <FooterAction.Primary
            onClick={() => {
              hide();
              onConfirm();
            }}
          >
            Imprimir
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </div>
  );
}
