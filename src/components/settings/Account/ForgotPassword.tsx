import { css } from '@emotion/react';
import Button from '../../common/Button';
import TextBox from '../../common/TextBox';
import { useThemeColors } from '../../hook/useThemeColors';
import React, { useState } from 'react';
import { displayToast, isValidEmail } from '../../../utils/helperFunctions';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../../config/firebase';
import { AppDispatch } from '../../../redux/store';
import { useDispatch } from 'react-redux';
import { AccountChildProps } from '../Account';
import {
  TEXTBOX_PLACEHOLDERS,
  TOAST_MESSAGES,
  TOOLTIP_MESSAGES,
} from '../../../utils/constants/common';

const ForgotPassword: React.FC<AccountChildProps> = ({
  handleCurrentPageChange,
}) => {
  const [email, setEmail] = useState<string>('');
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const forgotPassword = async () => {
    try {
      await sendPasswordResetEmail(auth, email);
      setEmail('');
      displayToast(dispatch, TOAST_MESSAGES.PASSWORD_RESET_SUCCESS);
      handleCurrentPageChange('signIn');
    } catch (error) {
      displayToast(dispatch, TOAST_MESSAGES.PASSWORD_RESET_FAIL);
    }
  };

  const validateCredentials = () => {
    if (!isValidEmail(email)) {
      displayToast(dispatch, TOAST_MESSAGES.INVALID_EMAIL);
    } else {
      forgotPassword();
    }
  };

  const handleBackToSignInClick = () => {
    handleCurrentPageChange('signIn');
  };

  const handleCreateAccountClick = () => {
    handleCurrentPageChange('createAccount');
  };

  const handleEmailOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <TextBox
        title={TOOLTIP_MESSAGES.EMAIL}
        id="email"
        type="email"
        name="email"
        value={email}
        placeholder={TEXTBOX_PLACEHOLDERS.EMAIL}
        onChange={handleEmailOnChange}
        onKeyEnter={validateCredentials}
        style="width: 100%; margin-bottom: 8px; flex-grow: unset;"
      />
      <div
        css={css`
          margin-bottom: 8px;
        `}
      >
        <Button
          text="Reset Password"
          iconType="lock_reset"
          onClick={validateCredentials}
          style="width: 250px; justify-content: center;"
        />
      </div>

      <div
        css={css`
          margin-top: auto;
          margin-bottom: 40px;
        `}
      >
        <div>
          <Button
            text="Return to Sign In"
            onClick={handleBackToSignInClick}
            style={`border: none; width: 250px; justify-content: center; color: ${COLORS.LABEL_L3_COLOR}`}
          />
        </div>
        <div>
          <Button
            text="New here? Create an account"
            onClick={handleCreateAccountClick}
            style={`border: none; width: 250px; justify-content: center; color: ${COLORS.LABEL_L3_COLOR}`}
          />
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
