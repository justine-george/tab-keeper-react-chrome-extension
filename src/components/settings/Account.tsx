import { auth } from "../../config/firebase";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import Button from "../common/Button";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "../../redux/store";
import { css } from "@emotion/react";
import { NormalLabel } from "../common/Label";
import { useThemeColors } from "../hook/useThemeColors";
import TextBox from "../common/TextBox";
import { useState } from "react";
import { displayToast, isValidEmail, isValidPassword } from "../../utils/helperFunctions";

export const Account = () => {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const COLORS = useThemeColors();

  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
  );

  const dispatch: AppDispatch = useDispatch();

  console.log("Auth var:");
  console.log(auth);

  const createUserEmailPassword = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setEmail("");
      setPassword("");
    } catch (err) {
      displayToast(dispatch, "Failed to create account", undefined, err);
    }
  };
  const signInEmailPassword = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setEmail("");
      setPassword("");
    } catch (err) {
      displayToast(dispatch, "Failed to sign in", undefined, err);
    }
  };
  const forgotPassword = async () => {
    try {
      await sendPasswordResetEmail(auth, email);
      setEmail("");
      displayToast(dispatch, "Password Reset Email Sent, Check your Inbox");
    } catch (err) {
      displayToast(
        dispatch,
        "Failed to send password reset email",
        undefined,
        err
      );
    }
  };
  const validateCredentials = () => {
    if (!isValidEmail(email)) {
      displayToast(dispatch, "Invalid Email");
    } else if (!isValidPassword(password)) {
      displayToast(dispatch, "Invalid Password");
    } else {
      signInEmailPassword();
    }
  };
  const logOut = async () => {
    try {
      await signOut(auth);
      displayToast(dispatch, "Logged out!");
    } catch (err) {
      displayToast(dispatch, "Failed to Logout", undefined, err);
    }
  };

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 250px;
      `}
    >
      {isSignedIn ? (
        <>
          <NormalLabel
            value={"Welcome " + auth?.currentUser?.email + "!"}
            size="1rem"
            color={COLORS.TEXT_COLOR}
            style="max-width: 350px; margin-bottom: 8px;"
          />
          <Button
            iconType="logout"
            text="Log Out"
            onClick={logOut}
            style="width: 250px; justify-content: center;"
          />
        </>
      ) : (
        <>
          <TextBox
            id="email"
            type="email"
            name="email"
            value={email}
            placeholder="Email"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setEmail(e.target.value)
            }
            onKeyEnter={validateCredentials}
            style="width: 100%; margin-bottom: 8px;"
          />
          <TextBox
            id="password"
            type="password"
            name="password"
            value={password}
            placeholder="Password"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPassword(e.target.value)
            }
            onKeyEnter={validateCredentials}
            style="width: 100%; margin-bottom: 8px;"
          />
          <div
            css={css`
              margin-bottom: 8px;
            `}
          >
            <Button
              text="Sign In"
              iconType="login"
              onClick={signInEmailPassword}
              style="width: 250px; justify-content: center;"
            />
          </div>

          <div
            css={css`
              margin-top: 40px;
              margin-bottom: 8px;
            `}
          >
            <Button
              text="Create an Account"
              // iconType="login"
              onClick={createUserEmailPassword}
              style={`border: none; width: 250px; justify-content: center; color: ${COLORS.LABEL_L3_COLOR}`}
            />
          </div>
          <div
            css={css`
              margin-bottom: 8px;
            `}
          >
            <Button
              text="Forgot Password"
              // iconType="login"
              onClick={forgotPassword}
              style={`border: none; width: 250px; justify-content: center; color: ${COLORS.LABEL_L3_COLOR}`}
            />
          </div>
        </>
      )}
    </div>
  );
};
