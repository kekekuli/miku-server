import { useDispatch, useSelector } from 'react-redux';
import { Dialog, Flex, Button } from '@radix-ui/themes';
import { closeModal } from '../lib/modalSlice';
import type { RootState } from '../lib/store';

export default function ModalProvider() {
  const dispatch = useDispatch();
  const { open, title, content } = useSelector((s: RootState) => s.modal);

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) dispatch(closeModal()); }}>
      <Dialog.Content>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{content}</Dialog.Description>
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" onClick={() => dispatch(closeModal())}>关闭</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
