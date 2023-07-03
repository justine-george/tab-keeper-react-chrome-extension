import styled from "@emotion/styled";
import { GLOBAL } from "../utils/constants";

export const TextInput = styled.input`
  background-color: ${GLOBAL.PRIMARY_COLOR};
  border: 1px solid black;
  padding: 10px;
  height: 3rem;
  flex-grow: 1;
  font-family: "Libre Franklin", sans-serif;
  font-size: 0.9rem;
  &:focus {
    outline: none;
  }
`;

export const Button = styled.button`
  background-color: ${GLOBAL.PRIMARY_COLOR};
  border: 1px solid black;
  padding: 10px 20px;
  height: 3rem;
  font-family: "Libre Franklin", sans-serif;
  font-size: 0.9rem;
  cursor: pointer;
`;
