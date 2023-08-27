import { signOut } from 'firebase/auth';
import { auth } from '../../../config/firebase';
import Button from '../../common/Button';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../hook/useThemeColors';
import { displayToast } from '../../../utils/helperFunctions';
import { AppDispatch } from '../../../redux/store';
import { useDispatch } from 'react-redux';
import { TOAST_MESSAGES } from '../../../utils/constants/common';
import { css } from '@emotion/react';

const LoggedIn: React.FC = () => {
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const logOut = async () => {
    try {
      await signOut(auth);
      displayToast(dispatch, TOAST_MESSAGES.LOGOUT_SUCCESS);
    } catch (error) {
      displayToast(dispatch, TOAST_MESSAGES.LOGOUT_FAIL);
    }
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  `;

  return (
    <div css={containerStyle}>
      <NormalLabel
        value={'Welcome ' + auth?.currentUser?.email + '!'}
        size="1rem"
        color={COLORS.TEXT_COLOR}
        style="max-width: 350px; margin-bottom: 16px;"
      />
      <Button
        iconType="logout"
        text="Sign Out"
        onClick={logOut}
        style="width: 250px; justify-content: center;"
      />
    </div>
  );
};

export default LoggedIn;
