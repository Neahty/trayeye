import { createContext, useContext } from "react";

export const AppContext = createContext({
  user: null,
  profile: null,
  reload: () => {},
  dataVersion: 0,
  bumpData: () => {}
});
export const useApp = () => useContext(AppContext);
