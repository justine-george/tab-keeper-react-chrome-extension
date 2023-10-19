import React, { useState } from 'react';

import { useDispatch } from 'react-redux';

import { css } from '@emotion/react';
import { signInWithEmailAndPassword } from 'firebase/auth';

import Button from '../../../common/Button';
import TextBox from '../../../common/TextBox';
import { AccountChildProps } from '../Account';
import { auth } from '../../../../config/firebase';
import { AppDispatch } from '../../../../redux/store';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { isValidEmail, isValidPassword } from '../../../../utils/functions/local';
import {
  TEXTBOX_PLACEHOLDERS,
  TOAST_MESSAGES,
  TOOLTIP_MESSAGES,
} from '../../../../utils/constants/common';
import { displayToast } from '../../../../utils/functions/external';

const SignIn: React.FC<AccountChildProps> = ({ handleCurrentPageChange }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const signInEmailPassword = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setEmail('');
      setPassword('');
    } catch (error) {
      displayToast(dispatch, TOAST_MESSAGES.LOGIN_FAIL, undefined, null);
    }
  };

  const validateCredentials = () => {
    if (!isValidEmail(email)) {
      displayToast(dispatch, TOAST_MESSAGES.INVALID_EMAIL);
    } else if (!isValidPassword(password)) {
      displayToast(dispatch, TOAST_MESSAGES.INVALID_PASSWORD);
    } else {
      signInEmailPassword();
    }
  };

  const handleCreateAccountClick = () => {
    handleCurrentPageChange('createAccount');
  };

  const handleForgotPasswordClick = () => {
    handleCurrentPageChange('forgotPassword');
  };

  const handleEmailOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  };

  const handlePasswordOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
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
      <TextBox
        title={TOOLTIP_MESSAGES.PASSWORD}
        id="password"
        type="password"
        name="password"
        value={password}
        placeholder={TEXTBOX_PLACEHOLDERS.PASSWORD}
        onChange={handlePasswordOnChange}
        onKeyEnter={validateCredentials}
        style="width: 100%; margin-bottom: 8px;  flex-grow: unset;"
      />
      <div
        css={css`
          margin-bottom: 8px;
        `}
      >
        <Button
          text="Sign In"
          iconType="login"
          onClick={validateCredentials}
          ariaLabel="Sign In to your account"
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
            text="Trouble logging in?"
            onClick={handleForgotPasswordClick}
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

export default SignIn;
