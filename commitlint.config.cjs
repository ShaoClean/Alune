module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Chinese descriptions and names such as GitHub/SSH are welcome.
    'subject-case': [0],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
