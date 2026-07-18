import { Redirect } from "expo-router";

/** 旧リンク互換。入力UIは /input に統合した。 */
export default function LegacyTransferRedirect() {
  return <Redirect href={{ pathname: "/input", params: { kind: "transfer" } }} />;
}
