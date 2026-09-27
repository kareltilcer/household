// A package in a module's testdata, which only the module's tests import, is held to the rule too.
package fixture

import _ "github.com/kareltilcer/household/server/internal/modules/finance"
