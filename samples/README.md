# samples/

Drop captcha input images here.

The CLI reads from this folder by default. Put your file as `captcha.png` and run:

```bash
npm run solve -- --target 447 --solver ocr
```

You can also pass any path explicitly with `--image`:

```bash
npm run solve -- --image ./samples/my-other-captcha.png --target 447 --solver openai
```

Supported formats: PNG, JPEG (anything `sharp` can read).
