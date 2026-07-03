<?php
namespace ElementorPro\Modules\AtomicForm\Actions;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Action_Log_Presenter {

	private $name;

	private $label;

	public function __construct( string $name, string $label ) {
		$this->name = $name;
		$this->label = $label;
	}

	public function get_name() {
		return $this->name;
	}

	public function get_label() {
		return $this->label;
	}
}
