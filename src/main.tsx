import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { GlobalStyle } from './styles';
import { store } from './store';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <Theme appearance="dark" accentColor="sky" grayColor="slate">
        <GlobalStyle />
        <App />
      </Theme>
    </Provider>
  </StrictMode>,
);
