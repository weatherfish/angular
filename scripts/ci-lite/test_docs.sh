#!/usr/bin/env bash

set -ex -o pipefail

if [[ ${TRAVIS} && ${CI_MODE} != "docs_test" ]]; then
  exit 0;
fi


echo 'travis_fold:start:test_docs'

# Setup environment
cd `dirname $0`
source ./env.sh

cd ../../aio
$(npm bin)/gulp docs-test
cd -

echo 'travis_fold:end:test_docs'
