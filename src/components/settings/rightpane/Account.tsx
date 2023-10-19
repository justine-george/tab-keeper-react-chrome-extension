import { useSelector } from 'react-redux';

import { css } from '@emotion/react';

import LoggedIn from './Account/LoggedIn';
import { RootState } from '../../../redux/store';
import NotLoggedIn from './Account/NotLoggedIn';

export type AccountPage = 'signIn' | 'createAccount' | 'forgotPassword';

export interface AccountChildProps {
  handleCurrentPageChange: (page: AccountPage) => void;
}

const Account: React.FC = () => {
  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
        width: 350px;
        height: 100%;
      `}
    >
      {isSignedIn ? <LoggedIn /> : <NotLoggedIn />}
    </div>
  );
};

export default Account;
