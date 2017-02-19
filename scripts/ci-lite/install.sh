#!/usr/bin/env bash

set -ex -o pipefail

echo 'travis_fold:start:INSTALL'

# Setup environment
cd `dirname $0`
source ./env.sh
cd ../..

mkdir -p ${LOGS_DIR}


# TODO: install nvm?? it's already on travis so we don't need it
#curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | bash


# Install node
#nvm install ${NODE_VERSION}


# Install version of npm that we are locked against
echo 'travis_fold:start:install.npm'
npm install -g npm@${NPM_VERSION}
echo 'travis_fold:end:install.npm'


# Install all npm dependencies according to shrinkwrap.json
echo 'travis_fold:start:install.node_modules'
node tools/npm/check-node-modules --purge || npm install
echo 'travis_fold:end:install.node_modules'


if [[ ${TRAVIS} && (${CI_MODE} == "e2e" || ${CI_MODE} == "aio" || ${CI_MODE} == "docs_test") ]]; then
  # Install version of yarn that we are locked against
  echo 'travis_fold:start:install.yarn'
  curl -o- -L https://yarnpkg.com/install.sh | bash -s -- --version "${YARN_VERSION}"
  echo 'travis_fold:end:install.yarn'
fi


if [[ ${TRAVIS} && (${CI_MODE} == "aio" || ${CI_MODE} == "docs_test") ]]; then
  # angular.io: Install all yarn dependencies according to angular.io/yarn.lock
  echo 'travis_fold:start:install.aio.node_modules'
  cd "`dirname $0`/../../aio"
  yarn install
  cd -
  echo 'travis_fold:end:install.aio.node_modules'
fi


# Install Chromium
echo 'travis_fold:start:install.chromium'
if [[ ${CI_MODE} == "js" || ${CI_MODE} == "e2e" || ${CI_MODE} == "aio" ]]; then
  ./scripts/ci/install_chromium.sh
fi
echo 'travis_fold:end:install.chromium'


# Install Sauce Connect
echo 'travis_fold:start:install.sauceConnect'
if [[ ${TRAVIS}] && (${CI_MODE} == "saucelabs_required" || ${CI_MODE} == "saucelabs_optional") ]]; then
  ./scripts/sauce/sauce_connect_setup.sh
fi
echo 'travis_fold:end:install.sauceConnect'


# Install BrowserStack Tunnel
echo 'travis_fold:start:install.browserstack'
if [[ ${TRAVIS} && (${CI_MODE} == "browserstack_required" || ${CI_MODE} == "browserstack_optional") ]]; then
  ./scripts/browserstack/start_tunnel.sh
fi
echo 'travis_fold:end:install.browserstack'


# node tools/chromedriverpatch.js
$(npm bin)/webdriver-manager update

# install bower packages
$(npm bin)/bower install

echo 'travis_fold:end:INSTALL'
