// Next.js declares this in next-env.d.ts, which is generated and not in git. Declaring it
// here keeps the typecheck working in a fresh checkout.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
