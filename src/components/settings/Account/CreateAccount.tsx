import React, { useState } from 'react';

import { useDispatch } from 'react-redux';

import { css } from '@emotion/react';
import { createUserWithEmailAndPassword } from 'firebase/auth';

import Button from '../../common/Button';
import TextBox from '../../common/TextBox';
import { AccountChildProps } from '../Account';
import { auth } from '../../../config/firebase';
import { AppDispatch } from '../../../redux/store';
import { useThemeColors } from '../../hook/useThemeColors';
import {
  displayToast,
  isValidEmail,
  isValidPassword,
} from '../../../utils/helperFunctions';
import {
  TEXTBOX_PLACEHOLDERS,
  TOAST_MESSAGES,
  TOOLTIP_MESSAGES,
} from '../../../utils/constants/common';

const CreateAccount: React.FC<AccountChildProps> = ({
  handleCurrentPageChange,
}) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [rePassword, setRePassword] = useState<string>('');
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const createUserEmailPassword = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setEmail('');
      setPassword('');
      displayToast(dispatch, TOAST_MESSAGES.ACCOUNT_CREATION_SUCCESS);
      handleCurrentPageChange('signIn');
    } catch (error) {
      displayToast(dispatch, TOAST_MESSAGES.ACCOUNT_CREATION_FAIL);
    }
  };

  const validateCredentials = () => {
    if (!isValidEmail(email)) {
      displayToast(dispatch, TOAST_MESSAGES.INVALID_EMAIL);
    } else if (!isValidPassword(password)) {
      displayToast(dispatch, TOAST_MESSAGES.INVALID_PASSWORD);
    } else if (password !== rePassword) {
      displayToast(dispatch, TOAST_MESSAGES.PASSWORD_MISMATCH);
    } else {
      createUserEmailPassword();
    }
  };

  const handleBackToSignInClick = () => {
    handleCurrentPageChange('signIn');
  };

  const handleEmailOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
  };

  const handlePasswordOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  };

  const handleRePasswordOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRePassword(e.target.value);
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
  `;

  return (
    <div css={containerStyle}>
      <TextBox
        title={TOOLTIP_MESSAGES.NEW_ACCOUNT_EMAIL}
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
        title={TOOLTIP_MESSAGES.NEW_ACCOUNT_PASSWORD}
        id="password"
        type="password"
        name="password"
        value={password}
        placeholder={TEXTBOX_PLACEHOLDERS.PASSWORD}
        onChange={handlePasswordOnChange}
        onKeyEnter={validateCredentials}
        style="width: 100%; margin-bottom: 8px; flex-grow: unset;"
      />
      <TextBox
        title={TOOLTIP_MESSAGES.NEW_ACCOUNT_CONFIRM_PASSWORD}
        id="repassword"
        type="password"
        name="repassword"
        value={rePassword}
        placeholder={TEXTBOX_PLACEHOLDERS.CONFIRM_PASSWORD}
        onChange={handleRePasswordOnChange}
        onKeyEnter={validateCredentials}
        style="width: 100%; margin-bottom: 8px; flex-grow: unset;"
      />
      <div
        css={css`
          margin-bottom: 8px;
        `}
      >
        <Button
          text="Create an Account"
          iconType="person_add"
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
            text="Already have an account? Sign In"
            onClick={handleBackToSignInClick}
            style={`border: none; padding: 2px; width: 250px; justify-content: center; color: ${COLORS.LABEL_L3_COLOR}`}
          />
        </div>
      </div>
    </div>
  );
};

export default CreateAccount;
