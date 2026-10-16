# Bundled rounded fonts

Korean text uses **NanumSquareRound Regular / Bold / ExtraBold**. Timer digits
and the wordmark use **Nunito Bold / ExtraBold**. Both desktop runtimes load
these bundled fonts privately; no system font installation is needed.

- NanumSquareRound TTFs are unmodified Naver distributions, referenced by the
  [official font stylesheet](https://hangeul.pstatic.net/hangeul_static/css/nanum-square-round.css).
  [Naver license](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko).
  Copyright and SIL Open Font License 1.1: `OFL-NanumSquareRound.txt`.
- Nunito static TTFs were instantiated at weights 700 and 800 with FontTools
  (`instantiateVariableFont(..., {"wght": weight}, inplace=False, updateFontNames=True)`)
  from the [Google Fonts upstream variable font](https://github.com/googlefonts/nunito/blob/main/fonts/variable/Nunito%5Bwght%5D.ttf).
  Font names remain Nunito; no Reserved Font Name applies in the source license.
  Copyright and SIL Open Font License 1.1: `OFL-Nunito.txt`.

Static fonts work with the OS-provided WPF and AppKit runtimes. The package
manifest covers each font and license. The native verifier checks the actual
resolved font rather than only the requested family name.
