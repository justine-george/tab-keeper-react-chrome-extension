import { useState } from 'react';
import { css } from '@emotion/react';
import { useSelector } from 'react-redux';
import { RootState } from '../../redux/store';
import LoggedIn from './Account/LoggedIn';
import SignIn from './Account/SignIn';
import CreateAccount from './Account/CreateAccount';
import ForgotPassword from './Account/ForgotPassword';

export type AccountPage = 'signIn' | 'createAccount' | 'forgotPassword';

export interface AccountChildProps {
  handleCurrentPageChange: (page: AccountPage) => void;
}

const Account: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<AccountPage>('signIn');
  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );

  const handleCurrentPageChange = (newPage: AccountPage) => {
    setCurrentPage(newPage);
  };

  const renderContentBasedOnPage = () => {
    switch (currentPage) {
      case 'signIn':
        return <SignIn handleCurrentPageChange={handleCurrentPageChange} />;
      case 'createAccount':
        return (
          <CreateAccount handleCurrentPageChange={handleCurrentPageChange} />
        );
      case 'forgotPassword':
        return (
          <ForgotPassword handleCurrentPageChange={handleCurrentPageChange} />
        );
      default:
        return null;
    }
  };

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
        width: 250px;
        height: 100%;
      `}
    >
      {isSignedIn ? <LoggedIn /> : renderContentBasedOnPage()}
    </div>
  );
};

export default Account;
