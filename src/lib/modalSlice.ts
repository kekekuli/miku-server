import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ReactNode } from 'react';

interface ModalState {
  open: boolean;
  title: string;
  content: ReactNode;
}

const initialState: ModalState = {
  open: false,
  title: '',
  content: null,
};

const modalSlice = createSlice({
  name: 'modal',
  initialState,
  reducers: {
    openModal(state, action: PayloadAction<{ title: string; content: ReactNode }>) {
      state.open = true;
      state.title = action.payload.title;
      state.content = action.payload.content;
    },
    closeModal(state) {
      state.open = false;
    },
  },
});

export const { openModal, closeModal } = modalSlice.actions;
export default modalSlice.reducer;
