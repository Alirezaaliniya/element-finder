<?php
namespace ElementorPro\Modules\DynamicTags\ACF\Tags;

use ElementorPro\Modules\DynamicTags\Tags\Base\Data_Tag;
use ElementorPro\Modules\DynamicTags\Tags\Base\License_Meta_Trait;
use ElementorPro\Modules\DynamicTags\Module as DynamicTagsModule;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

abstract class Base_ACF_Tag extends Data_Tag {
	use License_Meta_Trait;

	protected function get_required_license_feature() {
		return DynamicTagsModule::LICENSE_FEATURE_ACF_NAME;
	}
}

